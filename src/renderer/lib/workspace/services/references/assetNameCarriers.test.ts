import { describe, expect, it } from "vitest";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import type { StoryDocument } from "@shared/types/story";
import { createBlueprintFnRef } from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";
import { createExplicitBlueprintVariableRef } from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";
import { createAssetNameDescriber } from "./assetNameCatalog";
import { extractStoryVariableWrites, listAssetNameSinks, type AssetNameProject, type StoryVariableWrite } from "./assetNameGaps";
import {
    blueprint,
    document,
    element,
    gapsOf,
    graph,
    interfaceOf,
    shippingRegistry,
    type EdgeSpec,
    type NodeSpec,
} from "./assetNameTestKit";

/**
 * Every carrier a name can travel through between where it is made and where it is used.
 *
 * Each one gets the pair of tests the rule rests on: a name put together at run time is followed
 * through it to the place it picks an asset (the positive - a detection path with no test that hits
 * it is one that may never fire), and a name written in the project passes through it untouched (so
 * the rule does not refuse what the package carries).
 */

const SURFACE = "surface-1";
const ROOT = "root";
const PICTURE = "picture";
const SURFACE_INFO = { id: SURFACE, name: "Title", rootElementId: ROOT };
const WASHROOM = "b1a0c227-b4db-4156-875d-d2809aaa4c48";

const CONCAT: NodeSpec = { id: "halves", type: "blueprint.string.concat", params: { a: "b1a0c227-b4db-4156-", b: "875d-d2809aaa4c48" } };
const LITERAL: NodeSpec = { id: "picked", type: "blueprint.image.assetLiteral", params: { asset: { kind: "imageAsset", assetId: WASHROOM } } };
/** Where each source's value comes out. */
const OUT: Record<string, string> = { halves: "result", picked: "value" };

const pictureRef: NodeSpec = { id: "pictureRef", type: "blueprint.element.ref", params: { surfaceId: SURFACE, elementId: PICTURE, elementType: "nl.image" } };

/** A Set Image Asset on the picture, fed from `from`, run by the head `head`. */
function setPicture(from: [string, string], head = "click"): { nodes: NodeSpec[]; edges: EdgeSpec[] } {
    return {
        nodes: [pictureRef, { id: "show", type: "blueprint.element.image.setImageAsset" }],
        edges: [
            [head, "then", "show", "in"],
            ["pictureRef", "element", "show", "element"],
            [from[0], from[1], "show", "asset"],
        ],
    };
}

const widget = (elementId: string): BlueprintOwnerRef => ({ kind: "widgetMain", surfaceId: SURFACE, elementId });
const click: NodeSpec = { id: "click", type: "blueprint.event.head.mouseClick" };

function pageInterface(extra: ReturnType<typeof element>[] = []) {
    return interfaceOf(SURFACE_INFO, [
        element(ROOT, "nl.container", null, { childrenIds: [PICTURE, "writer", "reader", ...extra.map(entry => entry.id)] }),
        element(PICTURE, "nl.image", ROOT),
        element("writer", "nl.button", ROOT),
        element("reader", "nl.button", ROOT),
        ...extra,
    ]);
}

describe("a page variable", () => {
    /** One button writes the page's variable, another reads it into the picture. */
    function project(source: NodeSpec, setterId = "bp:page-var"): AssetNameProject {
        const page = blueprint("bp-page", "Title page", { kind: "surfaceMain", surfaceId: SURFACE }, {});
        const variable = createExplicitBlueprintVariableRef("bp-page", "chosen");
        const writer = blueprint("bp-writer", "Writer", widget("writer"), {
            ev: graph(
                [click, source, { id: "keep", type: "blueprint.local.set", params: { variableId: setterId === "bare" ? "chosen" : variable } }],
                [["click", "then", "keep", "in"], [source.id, OUT[source.id], "keep", "value"]],
            ),
        });
        const read = setPicture(["get", "value"]);
        const reader = blueprint("bp-reader", "Reader", widget("reader"), {
            ev: graph(
                [click, { id: "get", type: "blueprint.local.get", params: { variableId: variable } }, ...read.nodes],
                read.edges,
            ),
        });
        // The bare-id spelling is how the page's own graph names its variable.
        const blueprints = setterId === "bare"
            ? [blueprint("bp-page", "Title page", { kind: "surfaceMain", surfaceId: SURFACE }, writer.graphs.events as never), reader]
            : [page, writer, reader];
        return { blueprintDocument: document(...blueprints), uiDocument: pageInterface() };
    }

    it("carries a name put together in one graph to the picture another graph sets", () => {
        expect(gapsOf(project(CONCAT))).toEqual([
            expect.objectContaining({ origin: expect.objectContaining({ kind: "node", nodeId: "halves", blueprintId: "bp-writer" }) }),
        ]);
    });

    it("is the same variable whether the page's graph names it bare or another graph names it in full", () => {
        expect(gapsOf(project(CONCAT, "bare"))).toHaveLength(1);
    });

    it("passes a picture chosen in the picker", () => {
        expect(gapsOf(project(LITERAL))).toEqual([]);
    });

    it("assumes the worst of a variable a script layer can write", () => {
        const scripted = project(LITERAL);
        const page = scripted.blueprintDocument!.blueprints["bp-page"];
        page.graphs.events.script = { script: { source: "export default () => {}" } } as never;
        expect(gapsOf(scripted)).toEqual([
            expect.objectContaining({ origin: { kind: "script", blueprintId: "bp-page", blueprintName: "Title page" } }),
        ]);
    });
});

describe("a story variable", () => {
    function project(writes: StoryVariableWrite[]): AssetNameProject {
        const read = setPicture(["get", "value"]);
        const reader = blueprint("bp-reader", "Reader", widget("reader"), {
            ev: graph([click, { id: "get", type: "blueprint.saved.get", params: { savedVariableId: "saved-bg" } }, ...read.nodes], read.edges),
        });
        return { blueprintDocument: document(reader), uiDocument: pageInterface(), storyWrites: writes };
    }

    /** A story with one `/set` row into the saved variable, its right-hand side given. */
    function story(expression?: StoryDocument["scenes"][string]["blocks"][string]["payload"]): StoryDocument {
        return {
            id: "story-1",
            scenes: {
                "scene-1": {
                    id: "scene-1",
                    name: "Opening",
                    rootBlockIds: ["row-1"],
                    blocks: {
                        "row-1": {
                            id: "row-1",
                            kind: "action",
                            childrenIds: [],
                            payload: expression ?? { action: "setVariable", target: { scope: "saved", variableId: "saved-bg" }, value: WASHROOM },
                        },
                    },
                },
            },
        } as unknown as StoryDocument;
    }

    const computedRow = story({
        action: "setVariable",
        target: { scope: "saved", variableId: "saved-bg" },
        value: "",
        expression: {
            source: "\"b1a0c227-b4db-4156-\" + \"875d-d2809aaa4c48\"",
            ast: {
                kind: "binary",
                op: "+",
                left: { kind: "literal", value: "b1a0c227-b4db-4156-" },
                right: { kind: "literal", value: "875d-d2809aaa4c48" },
            },
        },
    } as never);

    it("names the row whose /set puts the value together", () => {
        expect(gapsOf(project(extractStoryVariableWrites(computedRow, "Main Story")))).toEqual([
            expect.objectContaining({
                origin: { kind: "storyRow", storyId: "story-1", storyName: "Main Story", sceneId: "scene-1", sceneName: "Opening", blockId: "row-1" },
            }),
        ]);
    });

    it("passes a row that writes the value down", () => {
        expect(gapsOf(project(extractStoryVariableWrites(story(), "Main Story")))).toEqual([]);
    });

    it("follows a row that copies one variable into another", () => {
        const copy = { target: { scope: "saved" as const, variableId: "saved-bg" }, reads: [{ scope: "saved" as const, variableId: "saved-src" }] };
        const source = { target: { scope: "saved" as const, variableId: "saved-src" }, reads: [], computed: extractStoryVariableWrites(computedRow, "Main Story")[0].computed };
        expect(gapsOf(project([copy, source]))).toHaveLength(1);
        expect(gapsOf(project([copy]))).toEqual([]);
    });
});

describe("a function", () => {
    const snapshot = {
        name: "Pick",
        params: [{ pinId: "param_1_value", name: "Name", valueType: "string" }],
        returns: [{ pinId: "ret_1_value", name: "Result", valueType: "string" }],
    };
    const head: NodeSpec = {
        id: "head",
        type: "blueprint.fn.head",
        params: { name: "Pick", __fnParamPinIds: ["param_1_value"] },
    };

    /** The project's function: shows its argument, or returns it for the caller to show. */
    function project(source: NodeSpec, mode: "param" | "return"): AssetNameProject {
        const body = mode === "param"
            ? graph([head, ...setPicture(["head", "param_1_value"], "head").nodes], setPicture(["head", "param_1_value"], "head").edges)
            : graph(
                [head, source, { id: "ret", type: "blueprint.fn.return", params: { __fnReturnPinIds: ["ret_1_value"] } }],
                [["head", "then", "ret", "in"], [source.id, OUT[source.id], "ret", "ret_1_value"]],
            );
        const global = blueprint("bp-global", "Global", { kind: "globalMain" }, { fns: body });
        const call: NodeSpec = { id: "call", type: "blueprint.fn.call", params: { fnRef: createBlueprintFnRef("bp-global", "head"), __fnSignatureSnapshot: snapshot } };
        const caller = mode === "param"
            ? graph([click, source, call], [["click", "then", "call", "in"], [source.id, OUT[source.id], "call", "param_1_value"]])
            : graph([click, call, ...setPicture(["call", "ret_1_value"]).nodes], [["click", "then", "call", "in"], ...setPicture(["call", "ret_1_value"]).edges.slice(1)]);
        return {
            blueprintDocument: document(global, blueprint("bp-caller", "Caller", widget("reader"), { ev: caller })),
            uiDocument: pageInterface(),
        };
    }

    it("carries an argument put together by the caller into the body that uses it", () => {
        expect(gapsOf(project(CONCAT, "param"))).toEqual([
            expect.objectContaining({
                sink: expect.objectContaining({ blueprintId: "bp-global" }),
                origin: expect.objectContaining({ nodeId: "halves", blueprintId: "bp-caller" }),
            }),
        ]);
        expect(gapsOf(project(LITERAL, "param"))).toEqual([]);
    });

    it("carries a value put together in the body back out to the caller", () => {
        expect(gapsOf(project(CONCAT, "return"))).toEqual([
            expect.objectContaining({
                sink: expect.objectContaining({ blueprintId: "bp-caller" }),
                origin: expect.objectContaining({ nodeId: "halves", blueprintId: "bp-global" }),
            }),
        ]);
        expect(gapsOf(project(LITERAL, "return"))).toEqual([]);
    });
});

describe("a list's rows", () => {
    const LIST = "list";
    const ROW_ART = "row-art";
    const rowArt = element(ROW_ART, "nl.image", LIST, { valueBindings: { "imageFill.assetId": { kind: "listItemField", fieldId: "image" } } });

    function project(options: { rows: NodeSpec[]; rowsEdges?: EdgeSpec[]; items: [string, string]; listTarget?: "self" | "ref" | "unknown"; listProps?: Record<string, unknown> }): AssetNameProject {
        const target = options.listTarget ?? "ref";
        const nodes: NodeSpec[] = [{ id: "init", type: "blueprint.event.head.init" }, ...options.rows];
        const edges: EdgeSpec[] = [["init", "then", "fill", "in"], [options.items[0], options.items[1], "fill", "items"], ...(options.rowsEdges ?? [])];
        if (target === "self") {
            nodes.push({ id: "fill", type: "blueprint.list.setItems" });
        } else {
            nodes.push({ id: "fill", type: "blueprint.element.list.setItems" });
            if (target === "ref") {
                nodes.push({ id: "listRef", type: "blueprint.element.ref", params: { surfaceId: SURFACE, elementId: LIST, elementType: "nl.list" } });
                edges.push(["listRef", "element", "fill", "list"]);
            } else {
                nodes.push({ id: "which", type: "blueprint.local.get", params: { variableId: "whichList" } });
                edges.push(["which", "value", "fill", "list"]);
            }
        }
        const owner = target === "self" ? { kind: "widgetMain" as const, surfaceId: SURFACE, elementId: LIST } : widget("writer");
        return {
            blueprintDocument: document(blueprint("bp-rows", "Rows", owner, { init: graph(nodes, edges) })),
            uiDocument: pageInterface([
                element(LIST, "nl.list", ROOT, { childrenIds: [ROW_ART], props: options.listProps ?? {} }),
                rowArt,
            ]),
        };
    }

    const assembledRows = {
        rows: [
            CONCAT,
            { id: "row", type: "blueprint.data.jsonMakeObject", params: { __jsonObjectInputPins: ["field_1_name", "field_1_value"], field_1_name: "image" } },
            { id: "rows", type: "blueprint.data.jsonMakeArray", params: { __jsonArrayInputPins: ["item_1"] } },
        ],
        rowsEdges: [["halves", "result", "row", "field_1_value"], ["row", "result", "rows", "item_1"]] as EdgeSpec[],
        items: ["rows", "result"] as [string, string],
    };
    const galleryRows = { rows: [{ id: "entries", type: "narraleaf.gallery.getEntries", params: { galleryKind: "cg" } }], items: ["entries", "entries"] as [string, string] };

    it("carries rows put together by a Set List Content into the picture a row draws", () => {
        expect(gapsOf(project(assembledRows))).toEqual([
            expect.objectContaining({ sink: expect.objectContaining({ kind: "binding", elementId: ROW_ART }), origin: expect.objectContaining({ nodeId: "halves" }) }),
        ]);
        expect(gapsOf(project(galleryRows))).toEqual([]);
    });

    it("does the same for the list's own Set List Content", () => {
        expect(gapsOf(project({ ...assembledRows, listTarget: "self" }))).toHaveLength(1);
        expect(gapsOf(project({ ...galleryRows, listTarget: "self" }))).toEqual([]);
    });

    it("counts rows written to a list it cannot name as written to every list", () => {
        expect(gapsOf(project({ ...assembledRows, listTarget: "unknown" }))).toHaveLength(1);
    });

    it("assumes the worst of rows kept in page state, which only a script writes", () => {
        expect(gapsOf(project({ ...galleryRows, listProps: { itemsBinding: { kind: "surfaceState", key: "rows" } } }))).toEqual([
            expect.objectContaining({ origin: { kind: "listSource", elementId: LIST, elementName: LIST } }),
        ]);
    });
});

describe("a clip wired into Play Sound", () => {
    const LIST = "music";

    function project(source: "row" | "concat"): AssetNameProject {
        const listOwner = { kind: "widgetMain" as const, surfaceId: SURFACE, elementId: LIST };
        const events = {
            fill: graph(
                [{ id: "init", type: "blueprint.event.head.init" }, { id: "entries", type: "narraleaf.gallery.getEntries", params: { galleryKind: "music" } }, { id: "fill", type: "blueprint.list.setItems" }],
                [["init", "then", "fill", "in"], ["entries", "entries", "fill", "items"]],
            ),
            play: graph(
                [
                    { id: "click", type: "blueprint.event.head.itemClick" },
                    source === "row" ? { id: "track", type: "blueprint.list.getItemField", params: { field: "audioAssetId" } } : { ...CONCAT, id: "track" },
                    { id: "play", type: "blueprint.sound.play", params: { audioTrackId: "bgm" } },
                ],
                [["click", "then", "play", "in"], ["track", source === "row" ? "value" : "result", "play", "assetId"]],
            ),
        };
        return {
            blueprintDocument: document(blueprint("bp-music", "Music rows", listOwner, events)),
            uiDocument: pageInterface([element(LIST, "nl.list", ROOT)]),
        };
    }

    it("is a place a clip is picked, and a track read off a Gallery row is one the package carries", () => {
        const sinks = listAssetNameSinks(project("row"), createAssetNameDescriber(shippingRegistry()));
        expect(sinks).toEqual([expect.objectContaining({ assetKind: "audio", sink: expect.objectContaining({ nodeId: "play", pinId: "assetId" }) })]);
        expect(gapsOf(project("row"))).toEqual([]);
    });

    it("refuses a clip named by a Concat", () => {
        expect(gapsOf(project("concat"))).toEqual([expect.objectContaining({ assetKind: "audio" })]);
    });
});

describe("what arrives on a broadcast", () => {
    function project(source: NodeSpec): AssetNameProject {
        const sender = blueprint("bp-writer", "Writer", widget("writer"), {
            ev: graph(
                [click, source, { id: "send", type: "blueprint.broadcast.send", params: { event: "show" } }],
                [["click", "then", "send", "in"], [source.id, OUT[source.id], "send", "data"]],
            ),
        });
        const shown = setPicture(["heard", "data"], "heard");
        const listener = blueprint("bp-reader", "Reader", widget("reader"), {
            ev: graph([{ id: "heard", type: "blueprint.event.head.onBroadcast", params: { event: "show" } }, ...shown.nodes], shown.edges),
        });
        return { blueprintDocument: document(sender, listener), uiDocument: pageInterface() };
    }

    it("carries a name put together by the sender to the listener that uses it", () => {
        expect(gapsOf(project(CONCAT))).toEqual([expect.objectContaining({ origin: expect.objectContaining({ blueprintId: "bp-writer" }) })]);
        expect(gapsOf(project(LITERAL))).toEqual([]);
    });
});

describe("nodes by what they declare", () => {
    function project(nodes: NodeSpec[], edges: EdgeSpec[], from: [string, string]): AssetNameProject {
        const shown = setPicture(from);
        return {
            blueprintDocument: document(blueprint("bp", "Page", widget("reader"), { ev: graph([click, ...nodes, ...shown.nodes], [...edges, ...shown.edges]) })),
            uiDocument: pageInterface(),
        };
    }
    const object = (source: NodeSpec): NodeSpec[] => [
        source,
        { id: "obj", type: "blueprint.data.jsonMakeObject", params: { __jsonObjectInputPins: ["field_1_name", "field_1_value"], field_1_name: "picture" } },
        { id: "field", type: "blueprint.data.jsonGet", params: { path: "picture" } },
    ];
    const objectEdges = (source: NodeSpec): EdgeSpec[] => [[source.id, OUT[source.id], "obj", "field_1_value"], ["obj", "result", "field", "json"]];

    it("follows a value through nodes that forward it, both ways", () => {
        expect(gapsOf(project(object(CONCAT), objectEdges(CONCAT), ["field", "result"]))).toHaveLength(1);
        expect(gapsOf(project(object(LITERAL), objectEdges(LITERAL), ["field", "result"]))).toEqual([]);
    });

    it("passes what a node reads out of what the project writes down", () => {
        const variant: NodeSpec = { id: "variant", type: "narraleaf.gallery.getVariant", params: { index: 0 } };
        expect(gapsOf(project([variant], [], ["variant", "image"]))).toEqual([]);
    });

    it("treats a node the catalogue has never heard of as putting the name together", () => {
        const stranger: NodeSpec = { id: "stranger", type: "acme.uninstalled.pickPicture" };
        expect(gapsOf(project([stranger], [], ["stranger", "picture"]))).toEqual([
            expect.objectContaining({ origin: expect.objectContaining({ nodeId: "stranger" }) }),
        ]);
    });
});
