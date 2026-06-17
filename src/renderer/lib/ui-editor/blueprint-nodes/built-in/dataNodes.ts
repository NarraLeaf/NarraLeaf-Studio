/**
 * Pure data literals and explicit value conversions.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_DATA_TO_BOOLEAN,
    BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_TO_INTEGER,
    BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
    BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
    BLUEPRINT_NODE_TYPE_DATA_JSON_HAS,
    BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_INT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON,
    BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_NULL,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
} from "@shared/types/blueprint/graph";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";

const GRAPH_KINDS = ["event", "function", "macro"] as const;
const JSON_OBJECT_INPUT_PINS_KEY = "__jsonObjectInputPins";
const JSON_OBJECT_FIELD_NAMES_KEY = "__jsonObjectFieldNames";
const JSON_ARRAY_INPUT_PINS_KEY = "__jsonArrayInputPins";

const dataOnlyExecute: BlueprintNodeDef["execute"] = ctx => {
    throw new BlueprintGraphExecutionError(
        "Data nodes are pure and must not sit on the execution path",
        ctx.node.id,
    );
};

const anyIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "any",
    label,
});

const stringIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "string",
    label,
    allowInlineLiteral: true,
});

const jsonIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "json",
    label,
});

const out = (id: string, label: string, valueType: string): BlueprintNodePinDef => ({
    id,
    kind: "output",
    semantic: "data",
    valueType,
    label,
});

function dataNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins: BlueprintNodePinDef[];
    category?: string;
    dynamicInputPins?: BlueprintNodeDef["dynamicInputPins"];
    inspectorParams?: BlueprintNodeDef["inspectorParams"];
    role?: BlueprintNodeDef["role"];
    hideInPalette?: boolean;
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: input.category ?? "Data",
        keywords: input.keywords,
        graphKinds: [...GRAPH_KINDS],
        hideInPalette: input.hideInPalette,
        isPure: true,
        role: input.role,
        pins: input.pins,
        dynamicInputPins: input.dynamicInputPins,
        inspectorParams: input.inspectorParams,
        execute: dataOnlyExecute,
    };
}

export const dataBlueprintNodes: BlueprintNodeDef[] = [
    dataNode({
        type: BLUEPRINT_NODE_TYPE_LITERAL,
        displayName: "Literal",
        keywords: ["literal", "value", "const"],
        hideInPalette: true,
        role: "dataLiteral",
        pins: [out("value", "Value", "any")],
        inspectorParams: [{ key: "value", label: "Value", kind: "literal" }],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
        displayName: "Text",
        keywords: ["literal", "string", "text", "value", "const"],
        role: "dataLiteral",
        pins: [out("value", "Text", "string")],
        inspectorParams: [{ key: "value", label: "Text", kind: "string" }],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
        displayName: "Float",
        keywords: ["literal", "number", "float", "value", "const"],
        role: "dataLiteral",
        pins: [out("value", "Float", "float")],
        inspectorParams: [{ key: "value", label: "Float", kind: "number" }],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
        displayName: "Boolean",
        keywords: ["literal", "boolean", "bool", "true", "false", "value", "const"],
        role: "dataLiteral",
        pins: [out("value", "Boolean", "boolean")],
        inspectorParams: [
            {
                key: "value",
                label: "Boolean",
                kind: "select",
                options: [
                    { value: "true", label: "True" },
                    { value: "false", label: "False" },
                ],
            },
        ],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_LITERAL_NULL,
        displayName: "Null",
        keywords: ["literal", "null", "none", "empty", "value", "const"],
        role: "dataLiteral",
        pins: [out("value", "Null", "json")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_LITERAL_JSON,
        displayName: "JSON",
        keywords: ["literal", "json", "object", "array", "value", "const"],
        category: "JSON",
        role: "dataLiteral",
        pins: [out("value", "JSON", "json")],
        inspectorParams: [{ key: "value", label: "JSON", kind: "json" }],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT,
        displayName: "To Float",
        keywords: ["convert", "cast", "number", "float"],
        pins: [anyIn("value", "Value"), out("result", "Float", "float")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_TO_INTEGER,
        displayName: "To Integer",
        keywords: ["convert", "cast", "number", "integer", "int"],
        pins: [anyIn("value", "Value"), out("result", "Integer", "integer")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_TO_BOOLEAN,
        displayName: "To Boolean",
        keywords: ["convert", "cast", "boolean", "bool"],
        pins: [anyIn("value", "Value"), out("result", "Boolean", "boolean")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
        displayName: "To JSON",
        keywords: ["convert", "cast", "json", "object", "array"],
        category: "JSON",
        pins: [anyIn("value", "Value"), out("result", "JSON", "json")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_PARSE_INT,
        displayName: "Parse Int",
        keywords: ["parse", "int", "integer", "string", "number"],
        pins: [stringIn("value", "Text"), out("result", "Integer", "integer")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_PARSE_FLOAT,
        displayName: "Parse Float",
        keywords: ["parse", "float", "number", "string"],
        pins: [stringIn("value", "Text"), out("result", "Float", "float")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON,
        displayName: "Parse JSON",
        keywords: ["parse", "json", "string", "object", "array"],
        category: "JSON",
        pins: [stringIn("value", "Text"), out("result", "JSON", "json")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
        displayName: "Stringify JSON",
        keywords: ["stringify", "json", "serialize", "string"],
        category: "JSON",
        pins: [jsonIn("value", "JSON"), out("result", "Text", "string")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
        displayName: "Get JSON Field",
        keywords: ["json", "field", "path", "dot", "get", "read"],
        category: "JSON",
        pins: [
            jsonIn("json", "JSON"),
            stringIn("path", "Path"),
            out("result", "Value", "json"),
        ],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_JSON_HAS,
        displayName: "Has JSON Field",
        keywords: ["json", "field", "path", "dot", "has", "exists"],
        category: "JSON",
        pins: [
            jsonIn("json", "JSON"),
            stringIn("path", "Path"),
            out("result", "Exists", "boolean"),
        ],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
        displayName: "Make JSON Object",
        keywords: ["json", "object", "make", "map", "struct", "field"],
        category: "JSON",
        pins: [out("result", "Object", "json")],
        dynamicInputPins: {
            storageKey: JSON_OBJECT_INPUT_PINS_KEY,
            fixedDataInputIds: [],
            generatedIdPrefix: "field",
            valueType: "any",
            allowInlineLiteral: false,
            labelPrefix: "Field",
            pinLabelParamKey: JSON_OBJECT_FIELD_NAMES_KEY,
            defaultPinLabelPrefix: "field",
        },
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY,
        displayName: "Make JSON Array",
        keywords: ["json", "array", "make", "list", "items"],
        category: "JSON",
        pins: [out("result", "Array", "json")],
        dynamicInputPins: {
            storageKey: JSON_ARRAY_INPUT_PINS_KEY,
            fixedDataInputIds: [],
            generatedIdPrefix: "item",
            valueType: "any",
            allowInlineLiteral: false,
            labelPrefix: "Item",
        },
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH,
        displayName: "JSON Array Length",
        keywords: ["json", "array", "length", "count", "size"],
        category: "JSON",
        pins: [jsonIn("value", "Array"), out("length", "Length", "integer")],
    }),
];
