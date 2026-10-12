import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentCallResult } from "@shared/agent/protocol";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { resolveEntrySurfaceId } from "@shared/types/ui-editor/entrySurface";
import { ensureWidgetModulesRegistered } from "@/lib/ui-editor/widget-modules/registryInstance";
import { HistoryService } from "../history/HistoryService";
import { blueprintHistoryScope, projectHistoryScope, uiComponentHistoryScope, uiSurfaceHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { StoryService } from "../story/StoryService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIEditorHistoryService } from "../ui-editor/UIEditorHistoryService";
import { ownerRefToIndexKey } from "../ui-editor/blueprint/ownerKeys";
import { AgentFollowService, type AgentWriteTarget } from "./AgentFollowService";
import { AgentRefusal, type AgentToolContext, type AgentToolHandler } from "./agentCall";
import { uiPageDelete, uiPageRename, uiPageSetEntry } from "./tools/uiPageTools";
import { blueprintRemove } from "./tools/blueprintTools";
import { forAgent } from "./tools/textFormat";
import { checkUiSource, formatUiDiagnostics } from "@/lib/agent-core";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * The page tools and blueprint removal over real interface and history services: each write is one
 * step of undo on the stack it belongs to, follow mode hears of it, and each refusal says why and
 * what to do instead.
 */

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = []): UIElement {
    return { id, type, name: id, parentId, childrenIds, layout: { x: 0, y: 0, width: 100, height: 40, opacity: 1, visible: true } };
}

function interfaceDocument(): UIDocument {
    const page = (id: string, name: string, rootElementId: string) =>
        ({ id, name, host: "app", kind: "appSurface", designSize: { width: 1280, height: 720 }, rootElementId }) as const;
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            page("title", "Title", "titleRoot"),
            page("extra", "Extra", "extraRoot"),
            page("spare", "Spare", "spareRoot"),
            { id: "dialog", name: "Dialogue", host: "player", kind: "stageSurface", designSize: { width: 1280, height: 720 }, rootElementId: "dialogRoot", mount: { kind: "slot", slotId: "dialog" } },
        ],
        elements: {
            titleRoot: element("titleRoot", "nl.root", null, ["extraButton"]),
            extraButton: element("extraButton", "nl.button", "titleRoot"),
            extraRoot: element("extraRoot", "nl.root", null, []),
            spareRoot: element("spareRoot", "nl.root", null, ["spareButton"]),
            spareButton: element("spareButton", "nl.button", "spareRoot"),
            dialogRoot: element("dialogRoot", "nl.root", null, []),
        },
        components: [],
        meta: {},
    } as UIDocument;
}

/** A widget blueprint with one layer holding one node with these params. */
function widgetBlueprint(id: string, name: string, surfaceId: string, elementId: string, params: Record<string, unknown>): Blueprint {
    return {
        id,
        name,
        owner: { kind: "widgetMain", surfaceId, elementId },
        graphs: {
            eventIds: ["layer"],
            events: { layer: { id: "layer", name: "Layer 1", graph: { nodes: { n1: { id: "n1", type: "blueprint.page.go", params } }, edges: [] } } },
            functions: {},
            macros: {},
        },
    } as never;
}

function blueprintDocument(blueprints: Blueprint[]): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: Object.fromEntries(blueprints.map(blueprint => [blueprint.id, blueprint])),
        ownerRecords: Object.fromEntries(blueprints.map(blueprint => [ownerRefToIndexKey(blueprint.owner), { blueprintId: blueprint.id }])),
        meta: {},
    } as BlueprintDocument;
}

type Tab = { id: string; payload?: unknown; title?: string };

function createHarness(blueprints: Blueprint[] = [], options: { tabs?: Tab[] } = {}) {
    const history = new HistoryService();
    const story = new StoryService();
    const uidoc = new UIDocumentService();
    const uiHistory = new UIEditorHistoryService();
    const graphDocument = { blueprintDocument: blueprintDocument(blueprints) };
    const context = {
        project: { resolve: (...parts: (string | string[])[]) => parts.flatMap(part => (Array.isArray(part) ? part : [part])).join("/") },
        services: {
            get(id: Services) {
                switch (id) {
                    case Services.History: return history;
                    case Services.Uuid: return { generate: () => crypto.randomUUID() };
                    case Services.Project: return { getProjectConfig: () => ({ metadata: { resolution: { width: 1280, height: 720 } } }) };
                    case Services.Story: return story;
                    case Services.UIDocument: return uidoc;
                    case Services.UIEditorHistory: return uiHistory;
                    case Services.UIGraph:
                        return { getDocument: () => graphDocument, applyGraphMutation: (mutator: (document: typeof graphDocument) => void) => mutator(graphDocument) };
                    case Services.LocalBlueprint:
                        return { applyBlueprintMutation: () => undefined, getBlueprintDocument: () => graphDocument.blueprintDocument };
                    case Services.UIBlueprintLifecycle: return { syncFromUidoc: () => undefined };
                    case Services.UI:
                        if (options.tabs) {
                            const tabs = options.tabs;
                            return {
                                editor: { getAll: () => [...tabs], close: (tabId: string) => tabs.splice(tabs.findIndex(tab => tab.id === tabId), 1) },
                                getStore: () => ({
                                    updateEditorTab: (tabId: string, updates: Partial<Tab>) => Object.assign(tabs.find(tab => tab.id === tabId) ?? {}, updates),
                                }),
                            };
                        }
                        throw new Error("No editor layout");
                    default: throw new Error(`Unexpected service ${id}`);
                }
            },
        } as never,
        commandLineRun: false,
    } as never;
    history.setContext(context);
    story.setContext(context);
    uidoc.setContext(context);
    uiHistory.setContext(context);
    (uiHistory as never as { init(ctx: unknown): void }).init(context);
    (uidoc as never as { document: UIDocument }).document = interfaceDocument();
    (uidoc as never as { scheduleAutoSave: () => void }).scheduleAutoSave = () => undefined;
    (story as never as { index: unknown }).index = { schemaVersion: 1, stories: [], meta: {} };

    const follow = new AgentFollowService();
    const writes: AgentWriteTarget[] = [];
    follow.onWrote(target => writes.push(target));
    const tool: AgentToolContext = {
        ctx: context,
        request: { callId: "call-1", tool: "test", args: {}, clientName: null, policy: { writesEnabled: true, allowedImportRoots: [] }, deadline: Date.now() + 60_000 },
        follow,
        offscreen: null as never,
        log: () => undefined,
    };
    const steps = (scopeId: string) => history.describe().find(stack => stack.scopeId === scopeId)?.undo ?? 0;
    const run = (handler: AgentToolHandler, args: Record<string, unknown>) => handler(args, tool);
    return { uidoc, history, graphDocument, follow, writes, steps, run };
}

function textOf(result: AgentCallResult): string {
    if (!result.ok) {
        throw new Error(`refused: ${result.error.code} ${result.error.message}`);
    }
    return result.content.map(item => (item.type === "text" ? item.text : "")).join("\n");
}

async function refusal(promise: Promise<AgentCallResult>): Promise<AgentRefusal> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof AgentRefusal) {
            return error;
        }
        throw error;
    }
    throw new Error("expected a refusal");
}

const surfaceNames = (uidoc: UIDocumentService) => uidoc.getDocument().surfaces.map(surface => surface.name);

beforeAll(async () => {
    await ensureWidgetModulesRegistered();
}, 120_000);

describe("ui_page_rename", () => {
    it("renames a page as one step on that page's own stack, and follow mode hears of it", async () => {
        const { uidoc, history, writes, steps, run } = createHarness();
        expect(textOf(await run(uiPageRename, { page: "Spare", name: "Gallery" }))).toContain('Renamed page "Spare" to "Gallery"');
        expect(surfaceNames(uidoc)).toContain("Gallery");
        expect(writes).toEqual([expect.objectContaining({ kind: "surface", surfaceId: "spare", name: "Gallery" })]);
        expect(steps(uiSurfaceHistoryScope("spare"))).toBe(1);
        history.undo(uiSurfaceHistoryScope("spare"));
        expect(surfaceNames(uidoc)).toContain("Spare");
    });

    it("re-titles the page's open tab, as the pages panel's rename does", async () => {
        const tabs: Tab[] = [
            { id: "ui-editor:surface:spare", title: "Spare", payload: { surfaceId: "spare" } },
            { id: "ui-editor:surface:extra", title: "Extra", payload: { surfaceId: "extra" } },
        ];
        const { run } = createHarness([], { tabs });
        await run(uiPageRename, { page: "Spare", name: "Gallery" });
        expect(tabs.map(tab => tab.title)).toEqual(["Gallery", "Extra"]);
    });

    it("is a step of its own, never folded into a rename the author just typed", async () => {
        const { uidoc, history, steps, run } = createHarness();
        uidoc.renameSurface("spare", "Typed");
        await run(uiPageRename, { page: "Typed", name: "Gallery" });
        expect(steps(uiSurfaceHistoryScope("spare"))).toBe(2);
        history.undo(uiSurfaceHistoryScope("spare"));
        expect(surfaceNames(uidoc)).toContain("Typed");
    });

    it("refuses a name another page has", async () => {
        const { run } = createHarness();
        expect((await refusal(run(uiPageRename, { page: "Spare", name: "Extra" }))).code).toBe("invalid_args");
    });
});

describe("ui_page_set_entry", () => {
    it("makes a page the entry as one step on the project's stack", async () => {
        const { uidoc, history, steps, run } = createHarness();
        expect(resolveEntrySurfaceId(uidoc.getDocument())).toBe("title");
        expect(textOf(await run(uiPageSetEntry, { page: "spare" }))).toContain('The game now opens on "Spare" instead of "Title"');
        expect(resolveEntrySurfaceId(uidoc.getDocument())).toBe("spare");
        expect(steps(projectHistoryScope())).toBe(1);
        history.undo(projectHistoryScope());
        expect(resolveEntrySurfaceId(uidoc.getDocument())).toBe("title");
    });

    it("refuses a Game UI", async () => {
        const { run } = createHarness();
        expect((await refusal(run(uiPageSetEntry, { page: "Dialogue" }))).code).toBe("invalid_args");
    });
});

describe("ui_page_delete", () => {
    it("refuses the entry page", async () => {
        const { run } = createHarness();
        const refused = await refusal(run(uiPageDelete, { page: "Title" }));
        expect(refused.hint).toContain("ui_page_set_entry");
    });

    it("refuses a page a blueprint elsewhere still opens, naming the blueprint", async () => {
        const { uidoc, run } = createHarness([widgetBlueprint("bp-extra", "Open extra", "title", "extraButton", { surfaceId: "extra" })]);
        const refused = await refusal(run(uiPageDelete, { page: "Extra" }));
        expect(refused.code).toBe("unavailable");
        expect(refused.message).toContain('blueprint "Open extra"');
        expect(surfaceNames(uidoc)).toContain("Extra");
    });

    it("deletes a page with its own blueprints as one step that undo puts back", async () => {
        // The page's own button opens the extra page; that is the page's business, not a reference to it.
        const { uidoc, history, graphDocument, steps, run } = createHarness([
            widgetBlueprint("bp-spare", "Spare button", "spare", "spareButton", { surfaceId: "spare" }),
        ]);
        expect(textOf(await run(uiPageDelete, { page: "Spare" }))).toContain('Deleted page "Spare"');
        expect(surfaceNames(uidoc)).not.toContain("Spare");
        expect(uidoc.getDocument().elements.spareButton).toBeUndefined();
        expect(graphDocument.blueprintDocument.blueprints["bp-spare"]).toBeUndefined();
        expect(steps(projectHistoryScope())).toBe(1);

        history.undo(projectHistoryScope());
        expect(surfaceNames(uidoc)).toEqual(["Title", "Extra", "Spare", "Dialogue"]);
        expect(uidoc.getDocument().elements.spareButton).toBeDefined();
        expect(graphDocument.blueprintDocument.blueprints["bp-spare"]).toBeDefined();
    });

    it("is refused with nothing deleted when the author pauses while it reads the stories", async () => {
        const { uidoc, follow, steps, run } = createHarness();
        // The bridge let the call in; the handler then awaits every story, and the author pauses.
        const pending = run(uiPageDelete, { page: "Spare" });
        follow.setPaused(true);
        const refused = await refusal(pending);
        expect(refused.code).toBe("paused");
        expect(refused.message).toContain("Nothing was deleted.");
        expect(surfaceNames(uidoc)).toContain("Spare");
        expect(steps(projectHistoryScope())).toBe(0);
    });
});

describe("blueprint_remove", () => {
    it("removes a blueprint as one step on its page's stack, as Studio records it, and undo there puts it back", async () => {
        const orphan = widgetBlueprint("bp-orphan", "Orphan", "title", "goneButton", { surfaceId: "extra" });
        const { history, graphDocument, steps, run } = createHarness([orphan]);
        expect(textOf(await run(blueprintRemove, { blueprint: "Orphan", dryRun: true }))).toContain("dry run: nothing written");
        expect(graphDocument.blueprintDocument.blueprints["bp-orphan"]).toBeDefined();

        expect(textOf(await run(blueprintRemove, { blueprint: "Orphan" }))).toContain("One step of undo in its page's editor.");
        expect(graphDocument.blueprintDocument.blueprints["bp-orphan"]).toBeUndefined();
        expect(Object.keys(graphDocument.blueprintDocument.ownerRecords)).toEqual([]);
        expect(steps(uiSurfaceHistoryScope("title"))).toBe(1);
        expect(steps(projectHistoryScope())).toBe(0);
        expect(steps(blueprintHistoryScope("bp-orphan"))).toBe(0);

        history.undo(uiSurfaceHistoryScope("title"));
        expect(graphDocument.blueprintDocument.blueprints["bp-orphan"]).toBeDefined();
        expect(graphDocument.blueprintDocument.ownerRecords[ownerRefToIndexKey(orphan.owner)]).toEqual({ blueprintId: "bp-orphan" });
        history.redo(uiSurfaceHistoryScope("title"));
        expect(graphDocument.blueprintDocument.blueprints["bp-orphan"]).toBeUndefined();
    });

    it("closes every tab still showing the blueprint, and nothing else", async () => {
        const orphan = widgetBlueprint("bp-orphan", "Orphan", "title", "goneButton", {});
        const tabs: Tab[] = [
            { id: "blueprint-entry:bp-orphan:title:goneButton:~", payload: { blueprintId: "bp-orphan" } },
            { id: "blueprint-entry:bp-orphan:~:~:~", payload: { blueprintId: "bp-orphan" } },
            { id: "blueprint-entry:bp-other:~:~:~", payload: { blueprintId: "bp-other" } },
            { id: "ui-editor:surface:title", payload: { surfaceId: "title" } },
        ];
        const { run } = createHarness([orphan], { tabs });
        await run(blueprintRemove, { blueprint: "bp-orphan" });
        expect(tabs.map(tab => tab.id)).toEqual(["blueprint-entry:bp-other:~:~:~", "ui-editor:surface:title"]);
    });

    it("records a component element's blueprint on its component's stack", async () => {
        const card = {
            id: "bp-card",
            name: "Card button",
            owner: { kind: "componentWidgetMain", componentId: "card", elementId: "goneInCard" },
            graphs: { eventIds: [], events: {}, functions: {}, macros: {} },
        } as never as Blueprint;
        const { uidoc, history, graphDocument, steps, run } = createHarness([card]);
        (uidoc.getDocument() as UIDocument).components = [
            { id: "card", name: "Card", rootElementId: "cardRoot", elements: { cardRoot: element("cardRoot", "nl.root", null) } },
        ];
        expect(textOf(await run(blueprintRemove, { blueprint: "bp-card" }))).toContain("One step of undo in its component's editor.");
        const scope = uiComponentHistoryScope("card");
        expect(steps(scope)).toBe(1);
        expect(steps(projectHistoryScope())).toBe(0);
        history.undo(scope);
        expect(graphDocument.blueprintDocument.blueprints["bp-card"]).toBeDefined();
    });

    it("refuses a page's own blueprint, which Studio puts back, and a name two blueprints share", async () => {
        const page = { id: "bp-page", name: "Page", owner: { kind: "surfaceMain", surfaceId: "title" }, graphs: { events: {}, functions: {}, macros: {} } } as never;
        const { run } = createHarness([
            page,
            widgetBlueprint("bp-a", "Twin", "title", "extraButton", {}),
            widgetBlueprint("bp-b", "Twin", "spare", "spareButton", {}),
        ]);
        expect((await refusal(run(blueprintRemove, { blueprint: "Page" }))).message).toContain("surfaceMain");
        expect((await refusal(run(blueprintRemove, { blueprint: "Twin" }))).hint).toContain("by its id");
    });

    it("is what the orphaned-blueprint warning names, not the command line", () => {
        // The Title page rewritten without its Extra button, whose blueprint would be left behind.
        const document = interfaceDocument();
        const check = checkUiSource(
            'surface Title id=title kind=appSurface size=1280x720\n    titleRoot: nl.root id=titleRoot @0,0 1280x720\n',
            { document, blueprintDocument: blueprintDocument([widgetBlueprint("bp-extra", "Open extra", "title", "extraButton", {})]) },
        );
        const report = formatUiDiagnostics(check.diagnostics);
        expect(report).toContain("ui.orphaned_blueprint");
        const text = forAgent(report);
        expect(text).toContain("blueprint_remove");
        expect(text).not.toContain("--project");
        expect(text).not.toContain("uigraphs.json");
    });
});
