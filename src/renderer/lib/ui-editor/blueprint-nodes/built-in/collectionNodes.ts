/**
 * Pure Collection helpers. They appear in the Data palette.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONTAINS,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_GET,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_INSERT,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_JOIN,
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
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: "Data",
        keywords: input.keywords,
        graphKinds: [...GRAPH_KINDS],
        isPure: true,
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
        type: BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_SET_FIELD,
        displayName: "Object Set Field",
        keywords: ["object", "set", "field", "collection"],
        pins: [jsonIn("object", "Object"), stringIn("field", "Field"), anyIn("value", "Value"), jsonOut("result", "Object")],
    }),
    collectionNode({
        type: BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_REMOVE_FIELD,
        displayName: "Object Remove Field",
        keywords: ["object", "remove", "field", "collection"],
        pins: [jsonIn("object", "Object"), stringIn("field", "Field"), jsonOut("result", "Object")],
    }),
];
