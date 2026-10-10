import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentCallResult } from "@shared/agent/protocol";
import type { StoryNoteBlock } from "@shared/types/story";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UILayout } from "@shared/types/ui-editor/document";
import { buildUIComponentEditorSurfaceId } from "@shared/types/ui-editor/componentInstanceKey";
import { commandI18nStore } from "@/lib/i18n";
import { ensureWidgetModulesRegistered } from "@/lib/ui-editor/widget-modules/registryInstance";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope, storySceneHistoryScope, uiSurfaceHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { StoryService } from "../story/StoryService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIEditorHistoryService } from "../ui-editor/UIEditorHistoryService";
import { AgentFollowService, type AgentWriteTarget } from "./AgentFollowService";
import { AgentRefusal, type AgentToolContext, type AgentToolHandler } from "./agentCall";
import { storyApply, storyShow } from "./tools/storyTextTools";
import { chapterDelete, chapterRename, sceneCreate } from "./tools/storyTools";
import { uiApply, uiShow } from "./tools/uiTextTools";
import { commitBlueprints, ownerQueryOf, sharedHistorySurface } from "./tools/blueprintTools";
import { ownerRefToIndexKey } from "../ui-editor/blueprint/ownerKeys";
import { diagnosticsForRefusal, forAgent, withCanonicalCommandVocabulary } from "./tools/textFormat";
import { formatCarriedFindings } from "@/lib/story-cli/apply";
import { formatDiagnostics } from "@/lib/story-cli/check";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * The `.story` and `.ui` write tools end to end over real services: show, edit the text, apply.
 * A write is one step of undo; a read the author has since overtaken is refused; a dry run writes
 * nothing; a header naming no scene is refused before anything is checked.
 */

const emptyBlueprints = (): BlueprintDocument => ({ schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION, blueprints: {}, ownerRecords: {}, meta: {} });

function note(id: string, value: string = id): StoryNoteBlock {
    return { id, kind: "note", parentId: null, childrenIds: [], payload: { text: { textId: `text-${id}`, value, role: "note" } } };
}

function element(id: string, type: string, parentId: string | null, childrenIds: string[], layout: Partial<UILayout> = {}, props?: Record<string, unknown>): UIElement {
    return {
        id,
        type,
        name: id,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 100, height: 40, opacity: 1, visible: true, ...layout },
        ...(props ? { props } : {}),
    };
}

function interfaceDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            { id: "page", name: "Title", host: "app", kind: "appSurface", designSize: { width: 1280, height: 720 }, rootElementId: "root" },
            { id: "other", name: "Other", host: "app", kind: "appSurface", designSize: { width: 1280, height: 720 }, rootElementId: "otherRoot" },
        ],
        elements: {
            root: element("root", "nl.root", null, ["title"], { width: 1280, height: 720 }),
            title: element("title", "nl.text", "root", [], { x: 10, y: 10 }, { text: "Hello" }),
            otherRoot: element("otherRoot", "nl.root", null, [], { width: 1280, height: 720 }),
        },
        components: [],
        meta: {},
    } as UIDocument;
}

function createHarness() {
    const history = new HistoryService();
    const story = new StoryService();
    const uidoc = new UIDocumentService();
    const uiHistory = new UIEditorHistoryService();
    const graphDocument = { blueprintDocument: emptyBlueprints() };
    let nextId = 0;
    const uuid = () => `00000000-0000-4000-8000-${(++nextId).toString(16).padStart(12, "0")}`;
    const ok = async () => ({ ok: true as const, data: undefined });
    const fs = {
        writeFileNoFollowOrCreate: vi.fn(ok),
        read: vi.fn(async () => ({ ok: false as const, error: { message: "missing", code: "ENOENT" } })),
        deleteFile: vi.fn(ok),
        deleteDir: vi.fn(ok),
        isFileExists: vi.fn(async () => ({ ok: true as const, data: false })),
        isDirExists: vi.fn(async () => ({ ok: true as const, data: true })),
        createDir: vi.fn(ok),
        mkdir: vi.fn(ok),
    };
    const context = {
        project: { resolve: (...parts: (string | string[])[]) => parts.flatMap(part => (Array.isArray(part) ? part : [part])).join("/") },
        services: {
            get(id: Services) {
                switch (id) {
                    case Services.History: return history;
                    case Services.FileSystem: return fs;
                    case Services.Uuid: return { generate: uuid };
                    case Services.Project: return { getProjectConfig: () => ({ metadata: { resolution: { width: 1280, height: 720 } } }) };
                    case Services.Story: return story;
                    case Services.UIDocument: return uidoc;
                    case Services.UIEditorHistory: return uiHistory;
                    case Services.UIGraph:
                        return { getDocument: () => graphDocument, applyGraphMutation: (mutator: (document: typeof graphDocument) => void) => mutator(graphDocument) };
                    case Services.LocalBlueprint:
                        return { applyBlueprintMutation: () => undefined, getBlueprintDocument: () => graphDocument.blueprintDocument };
                    case Services.UIBlueprintLifecycle: return { syncFromUidoc: () => undefined };
                    case Services.Assets: return { getAssets: () => ({}) };
                    case Services.Character: return { listCharacter: () => [] };
                    case Services.VariableRegistry: return { getRegistry: () => ({ schemaVersion: 1, entries: {} }) };
                    case Services.AudioTracks: return { listTracks: () => [] };
                    case Services.AppTags: return { listTags: () => [] };
                    case Services.AssetSets: return { listSets: () => [] };
                    case Services.Localization:
                        return { getKeysIfLoaded: () => undefined, loadKeys: async () => null, getConfiguration: () => ({ sourceLocale: "en", locales: [] }) };
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
    (story as never as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };

    const entry = story.createStory("Tale");
    const sceneId = story.getStoryDocument(entry.id).chapters[0].sceneIds[0];
    story.renameScene(entry.id, sceneId, "Opening");
    story.insertBlock(entry.id, sceneId, note("a", "first"), { parentId: null });

    const follow = new AgentFollowService();
    const writes: AgentWriteTarget[] = [];
    follow.onWrote(target => writes.push(target));
    const tool: AgentToolContext = {
        ctx: context,
        request: { callId: "call-1", tool: "test", args: {}, clientName: null, policy: { writesEnabled: true, allowedImportRoots: [] } },
        follow,
        offscreen: null as never,
        log: () => undefined,
    };
    const steps = (scopeId: string) => history.describe().find(stack => stack.scopeId === scopeId)?.undo ?? 0;
    const run = (handler: AgentToolHandler, args: Record<string, unknown>) => handler(args, tool);
    return { story, uidoc, history, context, graphDocument, storyId: entry.id, sceneId, writes, steps, run };
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

/** The first text item of a show answer: the revision comment and the `.story` file. */
async function showScene(run: ReturnType<typeof createHarness>["run"], scene: string) {
    const result = await run(storyShow, { scene });
    if (!result.ok || result.content[0].type !== "text") {
        throw new Error("show failed");
    }
    return { text: result.content[0].text, revision: (result.structured as { revision: number }).revision };
}

/** The file with a narration line added straight after its header. */
function withNarration(text: string, line: string): string {
    const lines = text.split("\n");
    const at = lines.findIndex(item => item.startsWith("#scene"));
    lines.splice(at + 1, 0, line);
    return lines.join("\n");
}

beforeAll(async () => {
    await ensureWidgetModulesRegistered();
}, 120_000);

describe("story_apply", () => {
    it("writes the scene as one undo step on its own stack, and follow mode hears of it", async () => {
        const { story, history, storyId, sceneId, writes, steps, run } = createHarness();
        const shown = await showScene(run, "Opening");
        expect(shown.text.split("\n")[0]).toMatch(/^# revision \d+/);

        const result = await run(storyApply, { source: withNarration(shown.text, "The rain had not stopped."), baseRevision: shown.revision });
        expect(textOf(result)).toContain("Written.");
        const rows = Object.values(story.getStoryDocument(storyId).scenes[sceneId].blocks);
        expect(rows.length).toBe(2);
        expect(writes).toEqual([expect.objectContaining({ kind: "scene", storyId, sceneId })]);

        const scope = storySceneHistoryScope(storyId, sceneId);
        expect(steps(scope)).toBe(1);
        history.undo(scope);
        expect(Object.keys(story.getStoryDocument(storyId).scenes[sceneId].blocks)).toEqual(["a"]);
    }, 60_000);

    it("writes nothing on a dry run", async () => {
        const { story, storyId, sceneId, writes, steps, run } = createHarness();
        const shown = await showScene(run, "Opening");
        const before = JSON.stringify(story.getStoryDocument(storyId).scenes[sceneId]);
        const result = await run(storyApply, { source: withNarration(shown.text, "Only a rehearsal."), dryRun: true });
        expect(textOf(result)).toContain("Dry run: nothing written.");
        expect(result.ok && result.structured?.written).toBe(false);
        expect(JSON.stringify(story.getStoryDocument(storyId).scenes[sceneId])).toBe(before);
        expect(steps(storySceneHistoryScope(storyId, sceneId))).toBe(0);
        expect(writes).toEqual([]);
    }, 60_000);

    it("refuses a stale read and leaves the author's edit alone", async () => {
        const { story, storyId, sceneId, run } = createHarness();
        const shown = await showScene(run, "Opening");
        story.updateBlock(storyId, sceneId, "a", note("a", "typed by the author").payload);
        const refused = await refusal(run(storyApply, { source: withNarration(shown.text, "Too late."), baseRevision: shown.revision }));
        expect(refused.code).toBe("stale_revision");
        expect(Object.keys(story.getStoryDocument(storyId).scenes[sceneId].blocks)).toEqual(["a"]);
    }, 60_000);

    it("refuses a header naming a scene that does not exist, pointing at scene_create", async () => {
        const { run } = createHarness();
        const byId = await refusal(run(storyApply, { source: "#format 1\n#story Tale\n#scene Gone ⟦11111111-2222-4333-8444-555555555555⟧\nHello." }));
        expect(byId.code).toBe("not_found");
        expect(byId.hint).toContain("scene_create");
        const byName = await refusal(run(storyApply, { source: "#format 1\n#story Tale\n#scene Nowhere\nHello." }));
        expect(byName.code).toBe("not_found");
        expect(byName.hint).toContain("scene_create");
    });
});

describe("scene_create in a story it creates, and the chapter tools", () => {
    it("puts the scene where it was asked, with no default chapter or scene beside it", async () => {
        const { story, run } = createHarness();
        const result = await run(sceneCreate, { name: "Arrival", story: "Side", chapter: "Prologue" });
        expect(textOf(result)).toContain('Created story "Side" with scene "Arrival" in chapter "Prologue"');
        const created = story.listStories().find(entry => entry.name === "Side")!;
        const document = story.getStoryDocument(created.id);
        expect(document.chapters.map(chapter => chapter.name)).toEqual(["Prologue"]);
        expect(document.chapters[0].sceneIds.map(id => document.scenes[id].name)).toEqual(["Arrival"]);
        expect(Object.keys(document.scenes)).toHaveLength(1);
        expect(document.entrySceneId).toBe(document.chapters[0].sceneIds[0]);
    }, 60_000);

    it("adds a scene to a story that exists as before, creating the chapter it names", async () => {
        const { story, storyId, run } = createHarness();
        await run(sceneCreate, { name: "Later", story: "Tale", chapter: "Two" });
        const document = story.getStoryDocument(storyId);
        expect(document.chapters.map(chapter => chapter.name)).toEqual(["Chapter 1", "Two"]);
    }, 60_000);

    it("renames a chapter as one undo step", async () => {
        const { story, storyId, history, run } = createHarness();
        await run(chapterRename, { chapter: "Chapter 1", name: "Act One" });
        expect(story.getStoryDocument(storyId).chapters[0].name).toBe("Act One");
        history.undo(projectHistoryScope());
        expect(story.getStoryDocument(storyId).chapters[0].name).toBe("Chapter 1");
    }, 60_000);

    it("deletes an empty chapter as one undo step, and refuses one that still holds scenes", async () => {
        const { story, storyId, history, run } = createHarness();
        const busy = await refusal(run(chapterDelete, { chapter: "Chapter 1" }));
        expect(busy.code).toBe("unavailable");
        expect(busy.message).toContain('"Opening"');

        const empty = story.createChapter(storyId, "Spare");
        await run(chapterDelete, { chapter: "Spare" });
        expect(story.getStoryDocument(storyId).chapters.map(chapter => chapter.id)).not.toContain(empty.id);
        history.undo(projectHistoryScope());
        expect(story.getStoryDocument(storyId).chapters.map(chapter => chapter.name)).toContain("Spare");

        const missing = await refusal(run(chapterDelete, { chapter: "Nowhere" }));
        expect(missing.code).toBe("not_found");
        expect(missing.hint).toContain('"Chapter 1"');
    }, 60_000);
});

describe("ui_apply", () => {
    async function showPage(run: ReturnType<typeof createHarness>["run"]) {
        const result = await run(uiShow, { surface: "Title" });
        return { text: textOf(result), revision: (result.ok ? result.structured?.revision : null) as number };
    }

    it("replaces one page as one undo step on that page's stack", async () => {
        const { uidoc, history, steps, writes, run } = createHarness();
        const shown = await showPage(run);
        const projectSteps = steps(projectHistoryScope());
        expect(shown.text.split("\n")[0]).toBe(`# revision ${shown.revision} - pass it to ui_apply as baseRevision`);
        const edited = shown.text.replace("Hello", "Welcome back");
        expect(edited).not.toBe(shown.text);

        const result = await run(uiApply, { source: edited, baseRevision: shown.revision });
        expect(textOf(result)).toContain("Surfaces replaced: Title");
        expect(uidoc.getDocument().elements.title.props?.text).toBe("Welcome back");
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(1);
        expect(steps(projectHistoryScope())).toBe(projectSteps);
        expect(writes).toEqual([expect.objectContaining({ kind: "surface", surfaceId: "page" })]);

        history.undo(uiSurfaceHistoryScope("page"));
        expect(uidoc.getDocument().elements.title.props?.text).toBe("Hello");
    }, 60_000);

    it("writes nothing on a dry run, and refuses a stale read", async () => {
        const { uidoc, steps, run } = createHarness();
        const shown = await showPage(run);
        const edited = shown.text.replace("Hello", "Rehearsal");
        const dry = await run(uiApply, { source: edited, dryRun: true });
        expect(textOf(dry)).toContain("Dry run: nothing written.");
        expect(uidoc.getDocument().elements.title.props?.text).toBe("Hello");
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(0);

        uidoc.updateElementProps("title", { text: "By hand" });
        const refused = await refusal(run(uiApply, { source: edited, baseRevision: shown.revision }));
        expect(refused.code).toBe("stale_revision");
        expect(uidoc.getDocument().elements.title.props?.text).toBe("By hand");
    }, 60_000);

    it("refuses a source with errors as check_failed, writing nothing", async () => {
        const { uidoc, run } = createHarness();
        const before = JSON.stringify(uidoc.getDocument());
        const refused = await refusal(run(uiApply, { source: "surface \"Title\" {\n  nl.nope \"x\"\n}\n" }));
        expect(refused.code).toBe("check_failed");
        expect(JSON.stringify(uidoc.getDocument())).toBe(before);
    }, 60_000);
});

describe("blueprint writes", () => {
    it("record a global blueprint as one project step that undoes exactly what it wrote", () => {
        const { context, graphDocument, history, steps } = createHarness();
        const existing = { id: "kept", name: "Kept", owner: { kind: "surfaceMain", surfaceId: "page" }, graphs: {} };
        graphDocument.blueprintDocument.blueprints.kept = existing as never;
        const before = steps(projectHistoryScope());
        commitBlueprints(context, [{ id: "bp-global", name: "Global", owner: { kind: "globalMain" }, graphs: {} } as never]);
        expect(graphDocument.blueprintDocument.blueprints["bp-global"]?.name).toBe("Global");
        expect(graphDocument.blueprintDocument.ownerRecords.globalMain).toEqual({ blueprintId: "bp-global" });
        expect(steps(projectHistoryScope())).toBe(before + 1);

        history.undo(projectHistoryScope());
        expect(graphDocument.blueprintDocument.blueprints["bp-global"]).toBeUndefined();
        expect(graphDocument.blueprintDocument.ownerRecords.globalMain).toBeUndefined();
        expect(graphDocument.blueprintDocument.blueprints.kept).toBeDefined();
        history.redo(projectHistoryScope());
        expect(graphDocument.blueprintDocument.ownerRecords.globalMain).toEqual({ blueprintId: "bp-global" });
    });
});

describe("withCanonicalCommandVocabulary", () => {
    it("prints in the canonical tokens and puts the author's setting back, even on a throw", () => {
        const original = commandI18nStore.getPreference();
        try {
            commandI18nStore.setPreference(true);
            expect(withCanonicalCommandVocabulary(() => commandI18nStore.getPreference())).toBe(false);
            expect(commandI18nStore.getPreference()).toBe(true);
            expect(() => withCanonicalCommandVocabulary(() => {
                throw new Error("print failed");
            })).toThrow("print failed");
            expect(commandI18nStore.getPreference()).toBe(true);
            // Nested pins keep the outermost value.
            withCanonicalCommandVocabulary(() => withCanonicalCommandVocabulary(() => undefined));
            expect(commandI18nStore.getPreference()).toBe(true);
        } finally {
            commandI18nStore.setPreference(original);
        }
    });
});

describe("text-format helpers", () => {
    it("puts a .story report's errors first, whole entries at a time", () => {
        const report = ["warn   line:2  a warning", "       code.warn", "error  line:5  an error", "       code.error", "", "Not checked here: x."].join("\n");
        expect(diagnosticsForRefusal(report).split("\n").slice(0, 4)).toEqual([
            "error  line:5  an error",
            "       code.error",
            "warn   line:2  a warning",
            "       code.warn",
        ]);
    });

    it("puts blueprints of one page on that page's stack, and anything wider on none", () => {
        const owned = (owner: unknown) => ({ id: "b", name: "b", owner, graphs: {} }) as never;
        expect(sharedHistorySurface([
            owned({ kind: "surfaceMain", surfaceId: "page" }),
            owned({ kind: "widgetMain", surfaceId: "page", elementId: "x" }),
        ])).toBe("page");
        expect(sharedHistorySurface([owned({ kind: "componentWidgetMain", componentId: "c", elementId: "x" })]))
            .toBe(buildUIComponentEditorSurfaceId("c"));
        expect(sharedHistorySurface([owned({ kind: "globalMain" })])).toBeNull();
        expect(sharedHistorySurface([
            owned({ kind: "surfaceMain", surfaceId: "page" }),
            owned({ kind: "surfaceMain", surfaceId: "other" }),
        ])).toBeNull();
    });
});

describe("forAgent", () => {
    it("points an agent at the lint tool, not at a command line it does not have", () => {
        expect(forAgent(formatCarriedFindings(1))).toContain("The `lint` tool lists it.");
        expect(forAgent(formatCarriedFindings(3))).toContain("The `lint` tool lists them.");
        const report = forAgent(formatDiagnostics([], { notRun: ["assets", "blueprint"] }));
        expect(report).toContain("Not checked by this write: assets, blueprint.");
        expect(report).toContain("the `lint` tool runs them");
        expect(report).not.toMatch(/--project|only a running Studio/);
    });
});

describe("blueprint_show by owner key", () => {
    it("matches the title page's widgets by the key as their ids read, separator and all", () => {
        // acceptance run #2: `widgetMain:narraleaf-studio:main-surface:<elementId>`, the form the tool
        // description recommended, answered not_found - the stored key escapes the surface id.
        const stored = ownerRefToIndexKey({ kind: "widgetMain", surfaceId: "narraleaf-studio:main-surface", elementId: "start-button" });
        expect(ownerQueryOf("widgetMain:narraleaf-studio:main-surface:start-button")).toBe(stored);
        expect(ownerQueryOf(stored)).toBe(stored);
        expect(ownerQueryOf("开始")).toBe("开始");
    });
});
