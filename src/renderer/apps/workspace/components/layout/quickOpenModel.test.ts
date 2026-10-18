import { describe, expect, it, vi } from "vitest";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import {
    GLOBAL_MAIN_OWNER_KEY,
    componentWidgetMainOwnerKey,
    surfaceMainOwnerKey,
    widgetMainOwnerKey,
    widgetValueOwnerKey,
} from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import { getBlueprintEntryTabId } from "../../modules/blueprint-lite/blueprintEntryTabId";
import { getComponentEditorSurfaceId } from "../../modules/ui-editor/editors/componentEditorAdapter";
import { collectQuickOpenEntries } from "./quickOpenModel";

/**
 * A project holding three blueprints - the global one, a page's, and a component control's - with
 * the editor tabs in `openTabs` (id -> title) already open. Everything else quick open lists is empty.
 */
function workspace(openTabs: Record<string, string>) {
    const open = vi.fn();
    const services: Partial<Record<Services, unknown>> = {
        [Services.UI]: {
            editor: { open, get: (id: string) => (id in openTabs ? { id, title: openTabs[id] } : undefined) },
        },
        [Services.Story]: { listStories: () => [] },
        [Services.Character]: { listCharacter: () => [] },
        [Services.UIDocument]: { getDocument: () => ({ surfaces: [], components: [], elements: {} }) },
        [Services.Assets]: { getAssets: () => ({}) },
        [Services.LocalBlueprint]: {
            getBlueprintDocument: () => ({
                ownerRecords: {
                    [GLOBAL_MAIN_OWNER_KEY]: { blueprintId: "bp-app" },
                    [surfaceMainOwnerKey("title")]: { blueprintId: "bp-title" },
                    [componentWidgetMainOwnerKey("card", "label")]: { blueprintId: "bp-label" },
                },
                blueprints: {
                    "bp-app": { id: "bp-app", name: "Global" },
                    "bp-title": { id: "bp-title", name: "Title" },
                    "bp-label": { id: "bp-label", name: "Text" },
                },
            }),
        },
    };
    const context = { services: { get: (id: Services) => services[id] } } as unknown as WorkspaceContext;
    return { context, open };
}

/** Pick `blueprintId` in quick open and answer the tab it opened. */
function quickOpen(blueprintId: string, openTabs: Record<string, string> = {}): { id: string; title: string } {
    const { context, open } = workspace(openTabs);
    const entry = collectQuickOpenEntries(context).find(candidate => candidate.key === `blueprint:${blueprintId}`);
    if (!entry) {
        throw new Error(`quick open does not list ${blueprintId}`);
    }
    entry.open(context);
    expect(open).toHaveBeenCalledTimes(1);
    return open.mock.calls[0]![0];
}

describe("quick open on a blueprint", () => {
    // The reported failure: with App logic open from the interface panel, picking it in quick open
    // added a second tab, because the global blueprint's tab is keyed by the `globalMain` sentinel and
    // quick open left that slot empty.
    it("lands on the global blueprint's tab under the key the interface panel opens it with, keeping its name", () => {
        const panelTabId = getBlueprintEntryTabId({ blueprintId: "bp-app", surfaceId: GLOBAL_MAIN_OWNER_KEY });
        const tab = quickOpen("bp-app", { [panelTabId]: "App logic" });
        expect(tab.id).toBe(panelTabId);
        expect(tab.title).toBe("App logic");
    });

    it("lands on a component control's tab under its component editor's surface, as the inspector opens it", () => {
        const inspectorTabId = getBlueprintEntryTabId({
            blueprintId: "bp-label",
            surfaceId: getComponentEditorSurfaceId("card"),
            elementId: "label",
        });
        expect(quickOpen("bp-label").id).toBe(inspectorTabId);
    });

    it("lands on a page's tab under the page's own id", () => {
        expect(quickOpen("bp-title").id).toBe(getBlueprintEntryTabId({ blueprintId: "bp-title", surfaceId: "title" }));
    });

    it("names a tab it opens after the blueprint", () => {
        expect(quickOpen("bp-app").title).toBe("Global");
    });
});

/**
 * A blueprint is named after what it hangs on, so a project's pages each carry a "Config" button
 * blueprint and the picker listed them as identical rows. The detail says whose each one is, in the
 * words the search panel uses for the same blueprint.
 */
describe("quick open names a blueprint's owner", () => {
    function entriesWithDocument() {
        const services: Partial<Record<Services, unknown>> = {
            [Services.UI]: { editor: { open: vi.fn(), get: () => undefined } },
            [Services.Story]: { listStories: () => [] },
            [Services.Character]: { listCharacter: () => [] },
            [Services.UIDocument]: {
                getDocument: () => ({
                    surfaces: [{ id: "log", name: "Log" }, { id: "config", name: "Config" }],
                    components: [{ id: "card", name: "Card", elements: { label: { id: "label", name: "Caption", type: "text" } } }],
                    elements: {},
                }),
            },
            [Services.Assets]: { getAssets: () => ({}) },
            [Services.LocalBlueprint]: {
                getBlueprintDocument: () => ({
                    ownerRecords: {
                        [GLOBAL_MAIN_OWNER_KEY]: { blueprintId: "bp-app" },
                        [surfaceMainOwnerKey("config")]: { blueprintId: "bp-config" },
                        [componentWidgetMainOwnerKey("card", "label")]: { blueprintId: "bp-label" },
                    },
                    blueprints: {
                        "bp-app": { id: "bp-app", name: "Global" },
                        "bp-config": { id: "bp-config", name: "Config" },
                        "bp-label": { id: "bp-label", name: "Caption" },
                    },
                }),
            },
        };
        const context = { services: { get: (id: Services) => services[id] } } as unknown as WorkspaceContext;
        return collectQuickOpenEntries(context);
    }

    const detailOf = (blueprintId: string) =>
        entriesWithDocument().find(entry => entry.key === `blueprint:${blueprintId}`)?.detail;

    it("names a page's blueprint by its page", () => {
        expect(detailOf("bp-config")).toBe("Config");
    });

    it("names a component control's blueprint by its component and control", () => {
        expect(detailOf("bp-label")).toBe("Card › Caption");
    });

    it("names the project's own blueprint as the global one", () => {
        expect(detailOf("bp-app")).toBe("Global");
    });
});

/**
 * A page whose own container and whose rail item are both named after the page, and a name plate
 * with both logic and a value binding: four blueprints, two names.
 */
describe("quick open tells same-named controls apart", () => {
    function details() {
        const elements = {
            root: { id: "root", type: "nl.root", name: "Root", parentId: null },
            page: { id: "page", type: "nl.container", name: "Config", parentId: "root" },
            rail: { id: "rail", type: "nl.container", name: "Rail", parentId: "page" },
            railItem: { id: "railItem", type: "nl.text", name: "Config", parentId: "rail" },
            plate: { id: "plate", type: "nl.text", name: "Name plate", parentId: "page" },
        };
        const services: Partial<Record<Services, unknown>> = {
            [Services.UI]: { editor: { open: vi.fn(), get: () => undefined } },
            [Services.Story]: { listStories: () => [] },
            [Services.Character]: { listCharacter: () => [] },
            [Services.UIDocument]: {
                getDocument: () => ({ surfaces: [{ id: "config", name: "Config", rootElementId: "root" }], components: [], elements }),
            },
            [Services.Assets]: { getAssets: () => ({}) },
            [Services.LocalBlueprint]: {
                getBlueprintDocument: () => ({
                    ownerRecords: {
                        [widgetMainOwnerKey("config", "page")]: { blueprintId: "bp-page" },
                        [widgetMainOwnerKey("config", "railItem")]: { blueprintId: "bp-rail" },
                        [widgetMainOwnerKey("config", "plate")]: { blueprintId: "bp-plate" },
                        [widgetValueOwnerKey("config", "plate", "text")]: { blueprintId: "bp-plate-text" },
                    },
                    blueprints: {
                        "bp-page": { id: "bp-page", name: "Config" },
                        "bp-rail": { id: "bp-rail", name: "Config" },
                        "bp-plate": { id: "bp-plate", name: "Name plate" },
                        "bp-plate-text": { id: "bp-plate-text", name: "Name plate" },
                    },
                }),
            },
        };
        const context = { services: { get: (id: Services) => services[id] } } as unknown as WorkspaceContext;
        return Object.fromEntries(collectQuickOpenEntries(context).map(entry => [entry.key, entry.detail]));
    }

    it("names the group the rail item is in, and leaves the page's container as it was", () => {
        const read = details();
        expect(read["blueprint:bp-page"]).toBe("Config › Config");
        expect(read["blueprint:bp-rail"]).toBe("Config › Rail › Config");
    });

    it("marks a value binding by its kind next to the same control's logic", () => {
        const read = details();
        expect(read["blueprint:bp-plate"]).toBe("Config › Name plate");
        expect(read["blueprint:bp-plate-text"]).toBe("Config › Name plate · Widget value");
    });
});

/** An asset row's detail is the kind of asset it is, in the interface's words rather than the stored type. */
describe("quick open names an asset's kind", () => {
    function assetDetails() {
        const services: Partial<Record<Services, unknown>> = {
            [Services.UI]: { editor: { open: vi.fn(), get: () => undefined } },
            [Services.Story]: { listStories: () => [] },
            [Services.Character]: { listCharacter: () => [] },
            [Services.UIDocument]: { getDocument: () => ({ surfaces: [], components: [], elements: {} }) },
            [Services.Assets]: {
                getAssets: () => ({
                    image: { bg: { id: "bg", type: "image", name: "Corridor" } },
                    audio: { theme: { id: "theme", type: "audio", name: "Theme" } },
                    json: { table: { id: "table", type: "json", name: "Table" } },
                }),
            },
            [Services.LocalBlueprint]: { getBlueprintDocument: () => ({ ownerRecords: {}, blueprints: {} }) },
        };
        const context = { services: { get: (id: Services) => services[id] } } as unknown as WorkspaceContext;
        return Object.fromEntries(collectQuickOpenEntries(context).map(entry => [entry.key, entry.detail]));
    }

    it("reads the type as the properties panel heads the asset, not as its stored id", () => {
        const read = assetDetails();
        expect(read["asset:bg"]).toBe("Image");
        expect(read["asset:theme"]).toBe("Audio");
        expect(read["asset:table"]).toBe("JSON");
    });
});

/**
 * Two chapters with a "Corridor" each, two folders with a "bg" each, two characters named Aoi and two
 * identical clicks: every pair opens two different things, so no two of their rows may read the same.
 */
describe("quick open tells same-named rows of every kind apart", () => {
    function details() {
        const character = (id: string, name: string, groupId?: string) => ({
            profile: { getProfile: () => ({ id, name }), getGroupId: () => groupId },
        });
        const services: Partial<Record<Services, unknown>> = {
            [Services.UI]: { editor: { open: vi.fn(), get: () => undefined } },
            [Services.Story]: {
                listStories: () => [{ id: "main" }],
                getStoryDocument: () => ({
                    id: "main",
                    name: "Main",
                    chapters: [
                        { id: "c1", name: "Chapter 1", sceneIds: ["s1", "s2"] },
                        { id: "c2", name: "Chapter 2", sceneIds: ["s3"] },
                    ],
                    unassignedSceneIds: [],
                    scenes: {
                        s1: { id: "s1", name: "Corridor" },
                        s2: { id: "s2", name: "Club room" },
                        s3: { id: "s3", name: "Corridor" },
                    },
                }),
            },
            [Services.Character]: {
                listCharacter: () => [character("aoi", "Aoi"), character("aoi2", "Aoi", "extras"), character("narra", "Narra")],
                getGroup: (id: string) => (id === "extras" ? { id, name: "Extras" } : undefined),
            },
            [Services.UIDocument]: { getDocument: () => ({ surfaces: [], components: [], elements: {} }) },
            [Services.Assets]: {
                getAssets: () => ({
                    image: {
                        bg1: { id: "bg1", type: "image", name: "bg", groupId: "backgrounds" },
                        bg2: { id: "bg2", type: "image", name: "bg", groupId: "indoors" },
                        corridor: { id: "corridor", type: "image", name: "Corridor", groupId: "backgrounds" },
                    },
                    audio: {
                        click1: { id: "click1", type: "audio", name: "click", groupId: "ui" },
                        click2: { id: "click2", type: "audio", name: "click", groupId: "ui" },
                    },
                }),
                getGroupAssetsManager: () => ({
                    getGroups: (category: string) => category === "image"
                        ? [
                            { id: "backgrounds", name: "Backgrounds", category: "image" },
                            { id: "indoors", name: "Indoors", category: "image", parentGroupId: "backgrounds" },
                        ]
                        : [{ id: "ui", name: "UI sounds", category: "media" }],
                }),
            },
            [Services.LocalBlueprint]: { getBlueprintDocument: () => ({ ownerRecords: {}, blueprints: {} }) },
        };
        const context = { services: { get: (id: Services) => services[id] } } as unknown as WorkspaceContext;
        return Object.fromEntries(collectQuickOpenEntries(context).map(entry => [entry.key, entry.detail]));
    }

    it("names the chapter of each same-named scene, and leaves the scene that is alone as its story", () => {
        const read = details();
        expect(read["scene:main:s1"]).toBe("Main › Chapter 1");
        expect(read["scene:main:s3"]).toBe("Main › Chapter 2");
        expect(read["scene:main:s2"]).toBe("Main");
    });

    it("names the folder of each same-named asset, and leaves the asset that is alone as its kind", () => {
        const read = details();
        expect(read["asset:bg1"]).toBe("Image · Backgrounds");
        expect(read["asset:bg2"]).toBe("Image · Backgrounds › Indoors");
        expect(read["asset:corridor"]).toBe("Image");
    });

    it("names the group of a character whose name another character has", () => {
        const read = details();
        expect(read["character:aoi"]).toBeUndefined();
        expect(read["character:aoi2"]).toBe("Extras");
        expect(read["character:narra"]).toBeUndefined();
    });

    it("numbers the rows that read alike everywhere, in the order the project lists them", () => {
        const read = details();
        expect(read["asset:click1"]).toBe("Audio · UI sounds · Item 1");
        expect(read["asset:click2"]).toBe("Audio · UI sounds · Item 2");
    });
});
