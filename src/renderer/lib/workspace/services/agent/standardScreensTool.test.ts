import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentCallResult } from "@shared/agent/protocol";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { BLUEPRINT_NODE_TYPE_GAME_START_STORY } from "@shared/types/blueprint/graph";
import type { SaveSchema } from "@shared/types/saveSchema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { resolveEntrySurface } from "@shared/types/ui-editor/entrySurface";
import type { VariableRegistry } from "@shared/types/variables/registry";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { ensureWidgetModulesRegistered } from "@/lib/ui-editor/widget-modules/registryInstance";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { StoryService } from "../story/StoryService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIEditorHistoryService } from "../ui-editor/UIEditorHistoryService";
import { AgentFollowService } from "./AgentFollowService";
import type { AgentToolContext } from "./agentCall";
import { uiInstallStandardScreens } from "./tools/standardScreensTool";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/** The shipped skeleton's interface, handed over the way main reads it for a workspace. */
const SKELETON = path.resolve(__dirname, "../../../../../../resources/templates/skeleton/content/editor");
const readJson = (...parts: string[]) => JSON.parse(fs.readFileSync(path.join(SKELETON, ...parts), "utf8")) as unknown;

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        projectTemplates: {
            readInterface: async () => ({
                success: true,
                data: {
                    uiDocument: readJson("ui", "uidoc.json"),
                    uiGraphs: readJson("ui", "uigraphs.json"),
                    brand: readJson("brand.json"),
                    localizationKeys: readJson("localization", "keys.json"),
                    variables: readJson("variables.json"),
                    saveSchema: readJson("save-schema.json"),
                    assetRecords: {},
                },
            }),
            readAssets: async () => ({ success: true, data: [] }),
        },
    }),
}));

/**
 * `ui_install_standard_screens` end to end over real interface, story and history services, on a
 * project made from the empty template: one blank page and nothing else.
 */

function emptyProjectInterface(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [{ id: "blank", name: "Page 1", host: "app", kind: "appSurface", designSize: { width: 1920, height: 1080 }, rootElementId: "blankRoot" }],
        elements: {
            blankRoot: {
                id: "blankRoot",
                type: "nl.root",
                name: "Root",
                parentId: null,
                childrenIds: [],
                layout: { x: 0, y: 0, width: 1920, height: 1080, opacity: 1, visible: true },
            },
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
    const graphDocument = {
        blueprintDocument: { schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION, blueprints: {}, ownerRecords: {}, meta: {} } as BlueprintDocument,
    };
    const registry: VariableRegistry = { schemaVersion: 2, entries: {} } as VariableRegistry;
    let saveSchema: SaveSchema = { schemaVersion: 1, fields: {} } as SaveSchema;
    const ok = async () => ({ ok: true as const, data: undefined });
    const fsService = {
        writeFileNoFollowOrCreate: vi.fn(ok),
        read: vi.fn(async () => ({ ok: false as const, error: { message: "missing", code: "ENOENT" } })),
        deleteFile: vi.fn(ok),
        deleteDir: vi.fn(ok),
        isFileExists: vi.fn(async () => ({ ok: true as const, data: false })),
        isDirExists: vi.fn(async () => ({ ok: true as const, data: true })),
        createDir: vi.fn(ok),
        mkdir: vi.fn(ok),
    };
    const colors = new Map<string, unknown>();
    const context = {
        project: { resolve: (...parts: (string | string[])[]) => parts.flatMap(part => (Array.isArray(part) ? part : [part])).join("/") },
        services: {
            get(id: Services) {
                switch (id) {
                    case Services.History: return history;
                    case Services.FileSystem: return fsService;
                    case Services.Uuid: return { generate: () => crypto.randomUUID() };
                    case Services.Project:
                        return {
                            getProjectConfig: () => ({ name: "Test", metadata: { resolution: { width: 1920, height: 1080 } } }),
                            getLocalizationConfiguration: () => ({ sourceLocale: "en", locales: [] }),
                        };
                    case Services.Story: return story;
                    case Services.UIDocument: return uidoc;
                    case Services.UIEditorHistory: return uiHistory;
                    case Services.UIGraph:
                        return { getDocument: () => graphDocument, applyGraphMutation: (mutator: (document: typeof graphDocument) => void) => mutator(graphDocument) };
                    case Services.LocalBlueprint:
                        return {
                            applyBlueprintMutation: (mutator: (document: BlueprintDocument) => void) => mutator(graphDocument.blueprintDocument),
                            getBlueprintDocument: () => graphDocument.blueprintDocument,
                        };
                    case Services.UIBlueprintLifecycle: return { syncFromUidoc: () => undefined };
                    case Services.Assets: return { getAssets: () => ({}) };
                    case Services.Brand:
                        return {
                            getColor: (colorId: string) => colors.get(colorId),
                            adoptColors: (adopted: { id: string }[]) => {
                                adopted.forEach(color => colors.set(color.id, color));
                                return adopted.length;
                            },
                        };
                    case Services.VariableRegistry:
                        return { getRegistry: () => registry, applyRegistryMutation: (mutator: (next: VariableRegistry) => void) => mutator(registry) };
                    case Services.SaveSchema:
                        return { getSchema: () => saveSchema, replaceSchema: (next: SaveSchema) => { saveSchema = next; } };
                    case Services.BlueprintNodeCatalog:
                        // Studio's own nodes only: this project does not run the Gallery.
                        return { get: (type: string) => blueprintNodeRegistry.get(type) };
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
    (uidoc as never as { document: UIDocument }).document = emptyProjectInterface();
    (uidoc as never as { scheduleAutoSave: () => void }).scheduleAutoSave = () => undefined;
    (story as never as { index: unknown }).index = { schemaVersion: 1, stories: [], meta: {} };
    (story as never as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };
    const entry = story.createStory("Tale");
    const sceneId = story.getStoryDocument(entry.id).chapters[0].sceneIds[0];

    const tool: AgentToolContext = {
        ctx: context,
        request: { callId: "call-1", tool: "ui_install_standard_screens", args: {}, clientName: null, policy: { writesEnabled: true, allowedImportRoots: [] } },
        follow: new AgentFollowService(),
        offscreen: null as never,
        log: () => undefined,
    };
    const steps = () => history.describe().find(stack => stack.scopeId === projectHistoryScope())?.undo ?? 0;
    return { uidoc, history, graphDocument, registry, saveSchema: () => saveSchema, storyId: entry.id, sceneId, steps, run: (args: Record<string, unknown>) => uiInstallStandardScreens(args, tool) };
}

function structured(result: AgentCallResult): Record<string, unknown> {
    if (!result.ok) {
        throw new Error(`refused: ${result.error.code} ${result.error.message}`);
    }
    return result.structured ?? {};
}

beforeAll(async () => {
    await ensureWidgetModulesRegistered();
}, 120_000);

describe("ui_install_standard_screens", () => {
    it("writes nothing on a dry run, and says what would come and what would not", async () => {
        const { uidoc, graphDocument, steps, run } = createHarness();
        const answer = structured(await run({ dryRun: true }));
        expect(answer.written).toBe(false);
        expect((answer.pages as string[]).length).toBeGreaterThan(4);
        expect((answer.gameUis as string[]).length).toBe(4);
        expect((answer.leftOut as { needs: string[] }[]).map(item => item.needs.every(type => type.startsWith("narraleaf.gallery.")))).toEqual([true]);
        expect(uidoc.getDocument().surfaces.map(surface => surface.id)).toEqual(["blank"]);
        expect(Object.keys(graphDocument.blueprintDocument.blueprints)).toEqual([]);
        expect(steps()).toBe(0);
    }, 120_000);

    it("brings the working screens into an empty project as one step that undo takes back whole", async () => {
        const { uidoc, history, graphDocument, registry, saveSchema, storyId, sceneId, steps, run } = createHarness();
        const answer = structured(await run({}));
        expect(answer.written).toBe(true);

        const document = uidoc.getDocument();
        // The blank page made way, and the splash is what the game opens on.
        expect(document.surfaces.some(surface => surface.id === "blank")).toBe(false);
        expect(resolveEntrySurface(document)?.name).toBe("Splash");
        // Every Game UI slot is filled, and the dialogue box still advances on a click.
        const slots = document.surfaces.flatMap(surface => (surface.kind === "stageSurface" ? [surface.mount.slotId] : []));
        expect(slots.sort()).toEqual(["choice", "dialog", "notification", "onStage"]);
        const dialogue = document.surfaces.find(surface => surface.kind === "stageSurface" && surface.mount.slotId === "dialog");
        expect(dialogue?.actions?.map(item => item.actionId)).toContain("advance");
        expect(document.actions?.advance).toBeDefined();
        // Blueprints came with them, and Start begins this project's story.
        const starts = Object.values(graphDocument.blueprintDocument.blueprints)
            .flatMap(blueprint => Object.values(blueprint.graphs.events ?? {}))
            .flatMap(layer => Object.values(layer?.graph?.nodes ?? {}))
            .filter(node => node.type === BLUEPRINT_NODE_TYPE_GAME_START_STORY && node.params?.storyId);
        expect(starts.length).toBeGreaterThan(0);
        expect(starts.every(node => node.params?.storyId === storyId && node.params?.sceneId === sceneId)).toBe(true);
        // What the save pages read beyond the interface came too, under the template's ids.
        expect(Object.values(registry.entries).map(entry => entry.scope)).toContain("persistent");
        expect(Object.keys(saveSchema().fields).length).toBe(1);
        // The Extra page needs the Gallery, which this project does not run.
        expect(document.surfaces.some(surface => surface.name === "Extra")).toBe(false);

        expect(steps()).toBe(1);
        history.undo(projectHistoryScope());
        const undone = uidoc.getDocument();
        expect(undone.surfaces.map(surface => surface.id)).toEqual(["blank"]);
        expect(resolveEntrySurface(undone)?.id).toBe("blank");
        expect(Object.keys(graphDocument.blueprintDocument.ownerRecords)).toEqual([]);
    }, 120_000);

    it("refuses a second set beside working screens", async () => {
        const { uidoc, run } = createHarness();
        structured(await run({}));
        const surfaces = uidoc.getDocument().surfaces.length;
        await expect(run({})).rejects.toMatchObject({ code: "unavailable" });
        expect(uidoc.getDocument().surfaces.length).toBe(surfaces);
    }, 120_000);

    it("leaves a Game UI slot the project fills alone, unless asked to replace it", async () => {
        const { uidoc, run } = createHarness();
        const document = uidoc.getDocument();
        document.surfaces.push({
            id: "mine",
            name: "My dialogue",
            host: "player",
            kind: "stageSurface",
            designSize: { width: 1920, height: 1080 },
            rootElementId: "mineRoot",
            mount: { kind: "slot", slotId: "dialog" },
        } as never);
        document.elements.mineRoot = { ...document.elements.blankRoot, id: "mineRoot" };
        const kept = structured(await run({ dryRun: true }));
        expect(kept.skippedSlots).toEqual(["dialog"]);
        const replaced = structured(await run({ dryRun: true, replace: true }));
        expect(replaced.skippedSlots).toEqual([]);
        expect((replaced.removed as { name: string }[]).map(item => item.name)).toContain("My dialogue");
    }, 120_000);
});
