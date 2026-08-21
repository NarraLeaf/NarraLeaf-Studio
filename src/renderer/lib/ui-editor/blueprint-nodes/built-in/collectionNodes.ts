/**
 * Pure Collection helpers. They appear in the Data palette.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONTAINS,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_GET,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_INSERT,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONCAT,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FILTER,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIND,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_INDEX_OF,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_IS_EMPTY,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_JOIN,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_LAST,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_RANGE,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_REVERSE,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SORT,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_UNIQUE,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_LENGTH,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_PUSH,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_REMOVE,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_REMOVE_AT,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SET,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SLICE,
    BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_KEYS,
    BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_MERGE,
    BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_REMOVE_FIELD,
    BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_SET_FIELD,
    BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_VALUES,
} from "@shared/types/blueprint/graph";
import { BLUEPRINT_VALUE_TYPE_ARRAY } from "@shared/types/blueprint/valueTypes";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";

const GRAPH_KINDS = ["event", "function", "macro"] as const;

const dataOnlyExecute: BlueprintNodeDef["execute"] = ctx => {
    throw new BlueprintGraphExecutionError(
        "Collection nodes are pure and must not sit on the execution path",
        ctx.node.id,
    );
};

const inPin = (
    id: string,
    label: string,
    valueType: string,
    allowInlineLiteral = false,
): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType,
    label,
    allowInlineLiteral,
});

const outPin = (id: string, label: string, valueType: string): BlueprintNodePinDef => ({
    id,
    kind: "output",
    semantic: "data",
    valueType,
    label,
});

const arrayIn = (id: string, label: string): BlueprintNodePinDef => inPin(id, label, BLUEPRINT_VALUE_TYPE_ARRAY);
const jsonIn = (id: string, label: string): BlueprintNodePinDef => inPin(id, label, "json");
const anyIn = (id: string, label: string): BlueprintNodePinDef => inPin(id, label, "any");
const intIn = (id: string, label: string): BlueprintNodePinDef => inPin(id, label, "integer", true);
const stringIn = (id: string, label: string): BlueprintNodePinDef => inPin(id, label, "string", true);
const arrayOut = (id: string, label: string): BlueprintNodePinDef => outPin(id, label, BLUEPRINT_VALUE_TYPE_ARRAY);
const jsonOut = (id: string, label: string): BlueprintNodePinDef => outPin(id, label, "json");

function collectionNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins: BlueprintNodePinDef[];
    hideInPalette?: boolean;
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: "Data",
        keywords: input.keywords,
        graphKinds: [...GRAPH_KINDS],
        isPure: true,
        hideInPalette: input.hideInPalette,
        pins: input.pins,
        execute: dataOnlyExecute,
    };
}

export const collectionBlueprintNodes: BlueprintNodeDef[] = [
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_LENGTH,
        displayName: "Array Length",
        keywords: ["array", "length", "count", "collection"],
        pins: [arrayIn("array", "Array"), outPin("length", "Length", "integer")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_GET,
        displayName: "Array Get",
        keywords: ["array", "get", "item", "index", "collection"],
        pins: [arrayIn("array", "Array"), intIn("index", "Index"), jsonOut("item", "Item")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SET,
        displayName: "Array Set",
        keywords: ["array", "set", "item", "index", "collection"],
        pins: [arrayIn("array", "Array"), intIn("index", "Index"), anyIn("item", "Item"), arrayOut("result", "Array")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_PUSH,
        displayName: "Array Push",
        keywords: ["array", "push", "append", "item", "collection"],
        pins: [arrayIn("array", "Array"), anyIn("item", "Item"), arrayOut("result", "Array")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_INSERT,
        displayName: "Array Insert",
        keywords: ["array", "insert", "item", "index", "collection"],
        pins: [arrayIn("array", "Array"), intIn("index", "Index"), anyIn("item", "Item"), arrayOut("result", "Array")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_REMOVE,
        displayName: "Array Remove",
        keywords: ["array", "remove", "delete", "item", "collection"],
        pins: [arrayIn("array", "Array"), anyIn("item", "Item"), arrayOut("result", "Array")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_REMOVE_AT,
        displayName: "Array Remove At",
        keywords: ["array", "remove", "delete", "index", "collection"],
        pins: [arrayIn("array", "Array"), intIn("index", "Index"), arrayOut("result", "Array")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONTAINS,
        displayName: "Array Contains",
        keywords: ["array", "contains", "includes", "item", "collection"],
        pins: [arrayIn("array", "Array"), anyIn("item", "Item"), outPin("result", "Contains", "boolean")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SLICE,
        displayName: "Array Slice",
        keywords: ["array", "slice", "range", "collection"],
        pins: [arrayIn("array", "Array"), intIn("start", "Start"), intIn("end", "End"), arrayOut("result", "Array")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_JOIN,
        displayName: "Array Join",
        keywords: ["array", "join", "string", "collection"],
        pins: [arrayIn("array", "Array"), stringIn("separator", "Separator"), outPin("result", "Text", "string")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_INDEX_OF,
        displayName: "Array Index Of",
        keywords: ["array", "index", "of", "find", "position", "collection"],
        pins: [arrayIn("array", "Array"), anyIn("item", "Item"), outPin("index", "Index", "integer")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST,
        displayName: "Array First",
        keywords: ["array", "first", "head", "front", "collection"],
        pins: [arrayIn("array", "Array"), jsonOut("item", "Item")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_LAST,
        displayName: "Array Last",
        keywords: ["array", "last", "tail", "back", "collection"],
        pins: [arrayIn("array", "Array"), jsonOut("item", "Item")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_IS_EMPTY,
        displayName: "Array Is Empty",
        keywords: ["array", "empty", "none", "blank", "collection"],
        pins: [arrayIn("array", "Array"), outPin("result", "Empty", "boolean")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_REVERSE,
        displayName: "Array Reverse",
        keywords: ["array", "reverse", "flip", "backwards", "collection"],
        pins: [arrayIn("array", "Array"), arrayOut("result", "Array")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONCAT,
        displayName: "Array Concat",
        keywords: ["array", "concat", "join", "append", "combine", "collection"],
        pins: [arrayIn("a", "A"), arrayIn("b", "B"), arrayOut("result", "Array")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_UNIQUE,
        displayName: "Array Unique",
        keywords: ["array", "unique", "distinct", "dedupe", "collection"],
        pins: [arrayIn("array", "Array"), arrayOut("result", "Array")],
    }),
    collectionNode({
        // Counts rather than bounds: "ten rows starting at one" is the question an author is asking,
        // and an end-exclusive bound is the form that produces an off-by-one every time.
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_RANGE,
        displayName: "Array Range",
        keywords: ["array", "range", "sequence", "numbers", "count", "collection"],
        pins: [intIn("start", "Start"), intIn("count", "Count"), intIn("step", "Step"), arrayOut("result", "Array")],
    }),
    collectionNode({
        // Keyed by a property name rather than by a comparator graph. A comparator is a function
        // value, which is the abstraction this whole round exists to stop asking authors for; sorting
        // records by one of their fields is what a list actually needs, and it needs no callback.
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SORT,
        displayName: "Array Sort By Key",
        keywords: ["array", "sort", "order", "key", "field", "collection"],
        pins: [
            arrayIn("array", "Array"),
            stringIn("key", "Key"),
            inPin("descending", "Descending", "boolean", true),
            arrayOut("result", "Array"),
        ],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FILTER,
        displayName: "Array Filter By Key",
        keywords: ["array", "filter", "where", "key", "field", "collection"],
        pins: [
            arrayIn("array", "Array"),
            stringIn("key", "Key"),
            anyIn("value", "Value"),
            arrayOut("result", "Array"),
        ],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIND,
        displayName: "Array Find By Key",
        keywords: ["array", "find", "search", "key", "field", "collection"],
        pins: [
            arrayIn("array", "Array"),
            stringIn("key", "Key"),
            anyIn("value", "Value"),
            jsonOut("item", "Item"),
            outPin("index", "Index", "integer"),
        ],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_KEYS,
        displayName: "Object Keys",
        keywords: ["object", "keys", "fields", "collection"],
        pins: [jsonIn("object", "Object"), arrayOut("result", "Keys")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_VALUES,
        displayName: "Object Values",
        keywords: ["object", "values", "fields", "collection"],
        pins: [jsonIn("object", "Object"), arrayOut("result", "Values")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_MERGE,
        displayName: "Object Merge",
        keywords: ["object", "merge", "combine", "collection"],
        pins: [jsonIn("a", "A"), jsonIn("b", "B"), jsonOut("result", "Object")],
    }),
    collectionNode({
        // Superseded by Set JSON Field, which takes a dotted path and so reaches a nested field this
        // one cannot. Kept registered for graphs that hold one, out of the palette so there is one
        // way to write a field rather than two that differ only in reach.
        type: BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_SET_FIELD,
        displayName: "Object Set Field",
        hideInPalette: true,
        keywords: ["object", "set", "field", "collection"],
        pins: [jsonIn("object", "Object"), stringIn("field", "Field"), anyIn("value", "Value"), jsonOut("result", "Object")],
    }),
    collectionNode({
        // Superseded by Remove JSON Field; see the note on Object Set Field.
        type: BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_REMOVE_FIELD,
        displayName: "Object Remove Field",
        hideInPalette: true,
        keywords: ["object", "remove", "field", "collection"],
        pins: [jsonIn("object", "Object"), stringIn("field", "Field"), jsonOut("result", "Object")],
    }),
];
