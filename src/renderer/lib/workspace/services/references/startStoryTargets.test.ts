import { describe, expect, it } from "vitest";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryDocument } from "@shared/types/story";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { PluginStoreReading } from "@shared/utils/pluginStorage";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { createAssetNameDescriber, type BlueprintNodeCatalogLike } from "./assetNameCatalog";
import { blueprint, document, element, graph, interfaceOf, shippingRegistry, type EdgeSpec, type NodeSpec } from "./assetNameTestKit";
import {
    createStartStoryTargetDescriber,
    readStartStoryTargets,
    scanProjectEntryPoints,
    type StartStoryTargetProject,
} from "./startStoryTargets";

/**
 * Where a `Start Game` whose picker does not settle it can begin: followed from the pin to where the
 * project writes the value down.
 *
 * The recollection screen is the case the reading exists for, so most of these build one: a list
 * filled from the Gallery's catalogue on init, whose Item Click starts the story and scene of the
 * clicked row. Each carrier the value can travel through gets the pair the rule rests on - a value
 * written down is read to the scenes it names, and a value put together stays unreadable and says
 * where.
 */

const SURFACE = "extra";
const ROOT = "root";
const LIST = "recollection";
const BUTTON = "button";
const STORY = "story-main";
const GALLERY = "narraleaf.gallery";

/** One story: an entry scene that goes nowhere, and three scenes nothing in the story reaches. */
function story(): StoryDocument {
    const sceneOf = (id: string) => ({ id, name: id.toUpperCase(), runtimeName: id, rootBlockIds: [], blocks: {} });
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: STORY,
        name: "Main",
        entrySceneId: "opening",
        chapters: [],
        scenes: Object.fromEntries(["opening", "rooftop", "station", "epilogue"].map(id => [id, sceneOf(id)])),
    } as StoryDocument;
}

function galleryCatalogue(scenes: string[]): PluginStoreReading {
    return {
        pluginId: GALLERY,
        namespace: `${GALLERY}.items`,
        data: {
            version: 4,
            groups: [],
            // A catalogue holds far more than scene ids - its own ids, names, art - and only the
            // scene ids may come out of it as entries.
            items: scenes.map((sceneId, index) => ({
                id: `${GALLERY}.entry-${index}`,
                name: `Memory ${index}`,
                kind: "scene",
                variants: [{ id: `${GALLERY}.entry-${index}.v1`, name: "Cover", imageAssetId: "b1a0c227-b4db-4156-875d-d2809aaa4c48" }],
                scene: { storyId: STORY, sceneId },
            })),
        },
    };
}

const pageInterface = (): UIDocument => interfaceOf({ id: SURFACE, name: "Extra", rootElementId: ROOT }, [
    element(ROOT, "nl.container", null, { childrenIds: [LIST, BUTTON] }),
    element(LIST, "nl.list", ROOT),
    element(BUTTON, "nl.button", ROOT),
]);

const listOwner: BlueprintOwnerRef = { kind: "widgetMain", surfaceId: SURFACE, elementId: LIST };
const buttonOwner: BlueprintOwnerRef = { kind: "widgetMain", surfaceId: SURFACE, elementId: BUTTON };

/** Fill the list from the Gallery's scene entries when it mounts. */
const fillFromGallery = graph(
    [
        { id: "init", type: "blueprint.event.head.init" },
        { id: "entries", type: "narraleaf.gallery.getEntries", params: { galleryKind: "scene" } },
        { id: "self", type: "blueprint.element.ref", params: { surfaceId: SURFACE, elementId: LIST, elementType: "nl.list" } },
        { id: "fill", type: "blueprint.element.list.setItems" },
    ],
    [
        ["init", "then", "entries", "in"],
        ["entries", "next", "fill", "in"],
        ["self", "element", "fill", "list"],
        ["entries", "entries", "fill", "items"],
    ],
);

/** On Item Click, start whatever the clicked row names - or whatever `sceneFrom` hands the pin. */
function replayClicked(sceneFrom?: { nodes: NodeSpec[]; from: [string, string] }) {
    const nodes: NodeSpec[] = [
        { id: "click", type: "blueprint.event.head.itemClick" },
        { id: "rowStory", type: "blueprint.list.getItemField", params: { field: "storyId" } },
        { id: "rowScene", type: "blueprint.list.getItemField", params: { field: "sceneId" } },
        { id: "play", type: "blueprint.game.startStory" },
        ...(sceneFrom?.nodes ?? []),
    ];
    const edges: EdgeSpec[] = [
        ["click", "then", "play", "in"],
        ["rowStory", "value", "play", "storyId"],
        [...(sceneFrom?.from ?? ["rowScene", "value"]), "play", "sceneId"],
    ];
    return graph(nodes, edges);
}

function project(overrides: Partial<StartStoryTargetProject> & { graphs?: Parameters<typeof document> } = {}): StartStoryTargetProject {
    const { graphs, ...rest } = overrides;
    return {
        stories: [{ id: STORY, name: "Main", document: story() }],
        blueprintDocument: document(...(graphs ?? [blueprint("bp-list", "Recollection", listOwner, { fill: fillFromGallery, open: replayClicked() })])),
        uiDocument: pageInterface(),
        variableRegistry: [],
        pluginStores: [galleryCatalogue(["rooftop", "station"])],
        ...rest,
    };
}

function scan(input: StartStoryTargetProject) {
    return scanProjectEntryPoints(input, createAssetNameDescriber(shippingRegistry()));
}

const entries = (input: StartStoryTargetProject) => [...(scan(input).scan.byStory.get(STORY) ?? [])].sort();

describe("a recollection list", () => {
    it("begins at every scene the Gallery's catalogue lists, and nowhere else", () => {
        const { scan: result } = scan(project());

        expect(result.undecidable).toEqual([]);
        // `opening` is the story's own entry; `epilogue` is in no catalogue row.
        expect([...(result.byStory.get(STORY) ?? [])].sort()).toEqual(["opening", "rooftop", "station"]);
    });

    it("begins nowhere when the catalogue lists no scene, without stopping the checks", () => {
        // The starter template's shape: the EXTRA screen is built, and nobody has filled the Gallery.
        expect(entries(project({ pluginStores: [] }))).toEqual(["opening"]);
        expect(scan(project({ pluginStores: [] })).scan.undecidable).toEqual([]);
    });

    it("does not read stores nobody read as a catalogue with nothing in it", () => {
        const { scan: result, gaps } = scan(project({ pluginStores: null }));

        expect(result.undecidable).toHaveLength(1);
        expect([...gaps.values()]).toEqual([{
            pin: "storyId",
            gap: expect.objectContaining({ kind: "unreadPluginData", pluginId: GALLERY }),
        }]);
    });

    it("does not read a store that would not open as one with nothing in it", () => {
        const { gaps } = scan(project({
            pluginStores: [{ pluginId: GALLERY, namespace: `${GALLERY}.items`, unreadable: true }],
        }));

        expect([...gaps.values()][0]?.gap.kind).toBe("unreadPluginData");
    });

    it("says where a scene id is put together, and makes no claim about where play begins", () => {
        const assembled = project({
            graphs: [blueprint("bp-list", "Recollection", listOwner, {
                fill: fillFromGallery,
                open: replayClicked({
                    nodes: [{ id: "join", type: "blueprint.string.concat", params: { a: "chapter-", b: "3" } }],
                    from: ["join", "result"],
                }),
            })],
        });
        const { scan: result, gaps } = scan(assembled);

        expect(result.undecidable).toEqual([expect.objectContaining({ blueprintName: "Recollection", nodeId: "play" })]);
        expect([...gaps.values()]).toEqual([{
            pin: "sceneId",
            gap: {
                kind: "assembled",
                origin: expect.objectContaining({ kind: "node", nodeId: "join", nodeTitle: "Concat", blueprintName: "Recollection" }),
            },
        }]);
    });

    it("reads rows an author wrote on the list the same way", () => {
        const withRows = pageInterface();
        withRows.elements[LIST] = element(LIST, "nl.list", ROOT, {
            props: { items: [{ storyId: STORY, sceneId: "epilogue", label: "The last day" }] },
        });

        expect(entries(project({ uiDocument: withRows, pluginStores: [] }))).toEqual(["epilogue", "opening"]);
    });

    it("cannot read a wired target without the interface document", () => {
        // With no interface there are no lists, and a list with no rows would read as a launcher
        // that begins nowhere - a claim nobody read the project to make.
        const { gaps } = scan(project({ uiDocument: null }));

        expect([...gaps.values()][0]?.gap).toEqual({ kind: "interfaceUnread" });
    });
});

describe("a row carried somewhere else first", () => {
    const savedPick: VariableRegistryEntry = {
        id: "saved-pick",
        name: "Picked scene",
        scope: "saved",
        valueType: "string",
        defaultValue: "",
        storageKey: "saved-pick",
    };

    /** The list keeps the clicked row's scene; a button elsewhere starts it. */
    function throughSaved(defaultValue: string) {
        return project({
            variableRegistry: [{ ...savedPick, defaultValue }],
            graphs: [
                blueprint("bp-list", "Recollection", listOwner, {
                    fill: fillFromGallery,
                    keep: graph(
                        [
                            { id: "click", type: "blueprint.event.head.itemClick" },
                            { id: "rowScene", type: "blueprint.list.getItemField", params: { field: "sceneId" } },
                            { id: "keep", type: "blueprint.saved.set", params: { savedVariableId: "saved-pick" } },
                        ],
                        [["click", "then", "keep", "in"], ["rowScene", "value", "keep", "value"]],
                    ),
                }),
                blueprint("bp-button", "Replay", buttonOwner, {
                    go: graph(
                        [
                            { id: "press", type: "blueprint.event.head.mouseClick" },
                            { id: "picked", type: "blueprint.saved.get", params: { savedVariableId: "saved-pick" } },
                            { id: "play", type: "blueprint.game.startStory", params: { storyId: STORY } },
                        ],
                        [["press", "then", "play", "in"], ["picked", "value", "play", "sceneId"]],
                    ),
                }),
            ],
        });
    }

    it("follows a saved variable back to the catalogue, and counts its default", () => {
        expect(entries(throughSaved(""))).toEqual(["opening", "rooftop", "station"]);
        expect(entries(throughSaved("epilogue"))).toEqual(["epilogue", "opening", "rooftop", "station"]);
    });

    it("cannot read a variable the project does not declare", () => {
        const input = throughSaved("");
        const { gaps } = scan({ ...input, variableRegistry: [] });

        expect([...gaps.values()][0]?.gap).toEqual({ kind: "undeclaredVariable", variableId: "saved-pick" });
    });

    it("takes the scene a story row writes into the variable", () => {
        const input = throughSaved("");
        const main = story();
        main.scenes.opening.rootBlockIds = ["set"];
        main.scenes.opening.blocks = {
            set: {
                id: "set",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: { action: "setVariable", target: { scope: "saved", variableId: "saved-pick" }, value: "epilogue" },
            },
        } as StoryDocument["scenes"][string]["blocks"];

        expect(entries({ ...input, stories: [{ id: STORY, name: "Main", document: main }] }))
            .toEqual(["epilogue", "opening", "rooftop", "station"]);
    });
});

describe("a component placed once per scene", () => {
    const COMPONENT = "scene-card";

    function cards(placements: string[]): StartStoryTargetProject {
        const ui = pageInterface();
        ui.components = [{
            id: COMPONENT,
            name: "Scene card",
            rootElementId: "card-root",
            elements: { "card-root": element("card-root", "nl.container", null) },
            params: [{ id: "sceneId", name: "Scene", type: "string", defaultValue: "rooftop" }],
        }];
        placements.forEach((sceneId, index) => {
            ui.elements[`card-${index}`] = element(`card-${index}`, "nl.container", ROOT, {
                extra: { componentLink: { componentId: COMPONENT, linked: true, params: { sceneId } } },
            });
        });
        const owner: BlueprintOwnerRef = { kind: "componentWidgetMain", componentId: COMPONENT, elementId: "card-root" };
        return project({
            uiDocument: ui,
            graphs: [blueprint("bp-card", "Scene card", owner, {
                go: graph(
                    [
                        { id: "press", type: "blueprint.event.head.mouseClick" },
                        { id: "param", type: "blueprint.component.getParam", params: { paramId: "sceneId" } },
                        { id: "play", type: "blueprint.game.startStory", params: { storyId: STORY } },
                    ],
                    [["press", "then", "play", "in"], ["param", "value", "play", "sceneId"]],
                ),
            })],
        });
    }

    it("begins at each placement's scene and at the declared default", () => {
        expect(entries(cards(["station", "epilogue"]))).toEqual(["epilogue", "opening", "rooftop", "station"]);
    });

    it("begins at the default alone while nothing places it", () => {
        expect(entries(cards([]))).toEqual(["opening", "rooftop"]);
    });
});

describe("the node's own picker", () => {
    it("still counts beside a wired pin, which falls back to it when the row is empty", () => {
        const picked = project({
            pluginStores: [],
            graphs: [blueprint("bp-list", "Recollection", listOwner, {
                fill: fillFromGallery,
                open: graph(
                    [
                        { id: "click", type: "blueprint.event.head.itemClick" },
                        { id: "rowScene", type: "blueprint.list.getItemField", params: { field: "sceneId" } },
                        { id: "play", type: "blueprint.game.startStory", params: { storyId: STORY, sceneId: "epilogue" } },
                    ],
                    [["click", "then", "play", "in"], ["rowScene", "value", "play", "sceneId"]],
                ),
            })],
        });

        expect(entries(picked)).toEqual(["epilogue", "opening"]);
    });

    it("reads a node with nothing wired from its picker alone", () => {
        const settled = project({
            graphs: [blueprint("bp-title", "Title", buttonOwner, {
                go: graph([{ id: "play", type: "blueprint.game.startStory", params: { storyId: STORY, sceneId: "station" } }], []),
            })],
        });

        const answers = readStartStoryTargets(settled, createAssetNameDescriber(shippingRegistry()));
        expect([...answers.values()]).toEqual([{ kind: "read", storyIds: [STORY], sceneIds: ["station"] }]);
    });
});

describe("the describer", () => {
    /** The shipping catalogue as a Studio that has not loaded the Gallery sees it. */
    function withoutGallery(): BlueprintNodeCatalogLike {
        const registry = shippingRegistry();
        const hidden = (type: string) => type.startsWith(`${GALLERY}.`);
        return {
            get: type => (hidden(type) ? undefined : registry.get(type)),
            resolveCatalogEntry: type => registry.resolveCatalogEntry(hidden(type) ? "unknown.node" : type),
            resolveCatalogEntryForNode: (type, params) => registry.resolveCatalogEntryForNode(hidden(type) ? "unknown.node" : type, params),
        };
    }

    it("knows a bundled plugin's nodes when this Studio has not loaded the plugin", () => {
        // A command-line run loads no plugins, and the question is about the shipped game, which
        // carries them. Read from the loaded catalogue alone, the Gallery's node is unknown - and
        // unknown reads as put together, which would stop the checks on every starter project.
        expect(createAssetNameDescriber(withoutGallery()).node(`${GALLERY}.getEntries`)).toBeNull();
        expect(createStartStoryTargetDescriber(withoutGallery()).node(`${GALLERY}.getEntries`)?.flow).toBe("written");

        const { scan: result } = scanProjectEntryPoints(project(), createStartStoryTargetDescriber(withoutGallery()));
        expect(result.undecidable).toEqual([]);
        expect([...(result.byStory.get(STORY) ?? [])].sort()).toEqual(["opening", "rooftop", "station"]);
    });
});
