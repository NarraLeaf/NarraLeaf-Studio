import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_PUSH,
    BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_MERGE,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_TIME,
    BLUEPRINT_NODE_TYPE_LIST_APPEND_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_TIME_FORMAT,
} from "@shared/types/blueprint/graph";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { AssetNameProject } from "./assetNameGaps";
import { blueprint, document, element, gapsOf, graph, interfaceOf, type EdgeSpec, type NodeSpec } from "./assetNameTestKit";

/**
 * A picture bound to one field of a list's rows reads that field only.
 *
 * The shape that used to be refused: save slots whose rows hold the slot's screenshot (`Get Save
 * Preview`, a picture the package carries) beside its date (`Format Time`, a string put together at
 * run time). The whole row was one value, so the date tainted the screenshot and a save screen could
 * not show both. Now only the field bound to the image fill is followed - and the date bound to an
 * image is still refused, so the check has not gone blind.
 */

const SURFACE = "load-page";
const ROOT = "root";
const LIST = "slots";
const PREVIEW = "preview-image";
const STRUCT = "slot-row";

/** A row shape whose field ids are not their keys, as an authored shape's are. */
function interfaceWith(boundField: "f-preview" | "f-date"): UIDocument {
    const ui = interfaceOf({ id: SURFACE, name: "Load", rootElementId: ROOT }, [
        element(ROOT, "nl.root", null, { childrenIds: [LIST] }),
        element(LIST, "nl.list", ROOT, { childrenIds: [PREVIEW], props: { itemStructId: STRUCT } }),
        element(PREVIEW, "nl.image", LIST, {
            name: "Preview",
            valueBindings: { "imageFill.assetId": { kind: "listItemField", fieldId: boundField } },
        }),
    ]);
    return {
        ...ui,
        structs: {
            [STRUCT]: {
                id: STRUCT,
                fields: [
                    { id: "f-preview", key: "preview", type: "image" },
                    { id: "f-date", key: "date", type: "string" },
                ],
            },
        },
    } as unknown as UIDocument;
}

const makeObject = (id: string, name: string): NodeSpec => ({
    id,
    type: BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
    params: { __jsonObjectInputPins: ["field_1_name", "field_1_value"], field_1_name: name },
});

/** The slot's two halves, each in an object of its own, joined with Object Merge. */
const ROW_NODES: NodeSpec[] = [
    { id: "loop", type: BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP, params: { start: 1, end: 6 } },
    { id: "shot", type: BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW },
    { id: "when", type: BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_TIME },
    { id: "date", type: BLUEPRINT_NODE_TYPE_TIME_FORMAT, params: { pattern: "yyyy-MM-dd HH:mm" } },
    makeObject("withShot", "preview"),
    makeObject("withDate", "date"),
    { id: "row", type: BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_MERGE },
];
const ROW_EDGES: EdgeSpec[] = [
    ["init", "then", "loop", "in"],
    ["loop", "loop", "shot", "in"],
    ["shot", "next", "when", "in"],
    ["shot", "preview", "withShot", "field_1_value"],
    ["when", "savedAt", "date", "timestamp"],
    ["date", "result", "withDate", "field_1_value"],
    ["withShot", "result", "row", "a"],
    ["withDate", "result", "row", "b"],
];

/** Rows appended one at a time by the list's own graph. */
function appended(boundField: "f-preview" | "f-date"): AssetNameProject {
    const nodes: NodeSpec[] = [
        { id: "init", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
        ...ROW_NODES,
        { id: "append", type: BLUEPRINT_NODE_TYPE_LIST_APPEND_ITEM },
    ];
    const edges: EdgeSpec[] = [
        ...ROW_EDGES,
        ["when", "next", "append", "in"],
        ["row", "result", "append", "item"],
        ["append", "next", "loop", "in"],
    ];
    return {
        blueprintDocument: document(blueprint("bp-slots", "Slots", { kind: "widgetMain", surfaceId: SURFACE, elementId: LIST }, { init: graph(nodes, edges) })),
        uiDocument: interfaceWith(boundField),
    };
}

/** Rows gathered in a variable with Array Push, then handed to the list in one Set Items. */
function gathered(boundField: "f-preview" | "f-date"): AssetNameProject {
    const nodes: NodeSpec[] = [
        { id: "init", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
        ...ROW_NODES,
        { id: "rowsSoFar", type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "rows" } },
        { id: "push", type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_PUSH },
        { id: "keep", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "rows" } },
        { id: "allRows", type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "rows" } },
        { id: "fill", type: BLUEPRINT_NODE_TYPE_LIST_SET_ITEMS },
    ];
    const edges: EdgeSpec[] = [
        ...ROW_EDGES,
        ["when", "next", "keep", "in"],
        ["rowsSoFar", "value", "push", "array"],
        ["row", "result", "push", "item"],
        ["push", "result", "keep", "value"],
        ["keep", "next", "loop", "in"],
        ["loop", "completed", "fill", "in"],
        ["allRows", "value", "fill", "items"],
    ];
    return {
        blueprintDocument: document(blueprint(
            "bp-slots",
            "Slots",
            { kind: "widgetMain", surfaceId: SURFACE, elementId: LIST },
            { init: graph(nodes, edges) },
            { members: { variables: { rows: { id: "rows", name: "rows", valueType: "array", defaultValue: [] } }, fields: {}, functions: {} } },
        )),
        uiDocument: interfaceWith(boundField),
    };
}

describe("a picture bound to one field of a list's rows", () => {
    it("is not tainted by a formatted date in another field of the same row", () => {
        expect(gapsOf(appended("f-preview"))).toEqual([]);
        expect(gapsOf(gathered("f-preview"))).toEqual([]);
    });

    it("is still refused when the field it is bound to is the one put together", () => {
        for (const project of [appended("f-date"), gathered("f-date")]) {
            expect(gapsOf(project)).toEqual([
                expect.objectContaining({
                    sink: expect.objectContaining({ kind: "binding", elementId: PREVIEW }),
                    origin: expect.objectContaining({ kind: "node", nodeId: "date" }),
                }),
            ]);
        }
    });

    it("follows the whole row when the field cannot be named - a list with no shape", () => {
        const project = appended("f-preview");
        const ui = project.uiDocument as UIDocument;
        const list = ui.elements[LIST];
        const shapeless = { ...ui, elements: { ...ui.elements, [LIST]: { ...list, props: {} } } } as UIDocument;
        expect(gapsOf({ ...project, uiDocument: shapeless })).toHaveLength(1);
    });
});
