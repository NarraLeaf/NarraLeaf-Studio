/**
 * Pure data literals and explicit value conversions.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_DATA_IS_ARRAY,
    BLUEPRINT_NODE_TYPE_DATA_IS_BOOLEAN,
    BLUEPRINT_NODE_TYPE_DATA_IS_EMPTY_VALUE,
    BLUEPRINT_NODE_TYPE_DATA_IS_NULL,
    BLUEPRINT_NODE_TYPE_DATA_IS_NUMBER,
    BLUEPRINT_NODE_TYPE_DATA_IS_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_IS_STRING,
    BLUEPRINT_NODE_TYPE_DATA_NOT_NULL,
    BLUEPRINT_NODE_TYPE_DATA_TO_BOOLEAN,
    BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_TO_INTEGER,
    BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
    BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
    BLUEPRINT_NODE_TYPE_DATA_JSON_HAS,
    BLUEPRINT_NODE_TYPE_DATA_JSON_SET,
    BLUEPRINT_NODE_TYPE_DATA_JSON_REMOVE,
    BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MERGE_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_JSON_CLONE,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_INT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON,
    BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
    BLUEPRINT_NODE_TYPE_LITERAL_COLOR,
    BLUEPRINT_NODE_TYPE_LITERAL_FLOAT,
    BLUEPRINT_NODE_TYPE_LITERAL_INTEGER,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_NULL,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LITERAL_RECT,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LITERAL_VECTOR2D,
} from "@shared/types/blueprint/graph";
import {
    BLUEPRINT_VALUE_TYPE_ARRAY,
    BLUEPRINT_VALUE_TYPE_RGBA_COLOR,
    BLUEPRINT_VALUE_TYPE_VECTOR2D,
} from "@shared/types/blueprint/valueTypes";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { resolveDataPinValue } from "./graphParamResolvers";

const GRAPH_KINDS = ["event", "function", "macro"] as const;
const JSON_OBJECT_INPUT_PINS_KEY = "__jsonObjectInputPins";
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
        displayName: "String",
        keywords: ["literal", "string", "text", "value", "const"],
        role: "dataLiteral",
        pins: [out("value", "String", "string")],
        inspectorParams: [{ key: "value", label: "String", kind: "string" }],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
        displayName: "Number",
        keywords: ["literal", "number", "float", "value", "const", "legacy"],
        hideInPalette: true,
        role: "dataLiteral",
        pins: [out("value", "Number", "float")],
        inspectorParams: [{ key: "value", label: "Number", kind: "number" }],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_LITERAL_INTEGER,
        displayName: "Integer",
        keywords: ["literal", "integer", "int", "number", "value", "const"],
        role: "dataLiteral",
        pins: [out("value", "Integer", "integer")],
        inspectorParams: [{ key: "value", label: "Integer", kind: "number" }],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_LITERAL_FLOAT,
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
        type: BLUEPRINT_NODE_TYPE_LITERAL_COLOR,
        displayName: "Color",
        keywords: ["literal", "color", "hex", "rgba", "value", "const"],
        role: "dataLiteral",
        pins: [out("value", "Color", BLUEPRINT_VALUE_TYPE_RGBA_COLOR)],
        inspectorParams: [{ key: "value", label: "Color", kind: "color" }],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_LITERAL_VECTOR2D,
        displayName: "Vector2D",
        keywords: ["literal", "vector", "vector2", "vector2d", "position", "point", "value", "const"],
        role: "dataLiteral",
        pins: [out("value", "Vector2D", BLUEPRINT_VALUE_TYPE_VECTOR2D)],
        inspectorParams: [
            {
                key: "value",
                label: "Vector2D",
                kind: "json",
                jsonSchema: {
                    kind: "object",
                    label: "Vector2D",
                    allowExtraFields: false,
                    fields: [
                        { key: "x", label: "X", kind: "number", required: true },
                        { key: "y", label: "Y", kind: "number", required: true },
                    ],
                },
            },
        ],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_LITERAL_RECT,
        displayName: "Rect",
        keywords: ["literal", "rect", "rectangle", "bounds", "value", "const"],
        role: "dataLiteral",
        pins: [out("value", "Rect", "json")],
        inspectorParams: [
            {
                key: "value",
                label: "Rect",
                kind: "json",
                jsonSchema: {
                    kind: "object",
                    label: "Rect",
                    allowExtraFields: false,
                    fields: [
                        { key: "x", label: "X", kind: "number", required: true },
                        { key: "y", label: "Y", kind: "number", required: true },
                        { key: "width", label: "Width", kind: "number", required: true },
                        { key: "height", label: "Height", kind: "number", required: true },
                    ],
                },
            },
        ],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_LITERAL_JSON,
        displayName: "JSON",
        keywords: ["literal", "json", "object", "array", "value", "const"],
        role: "dataLiteral",
        pins: [out("value", "JSON", "json")],
        inspectorParams: [{ key: "value", label: "JSON", kind: "json" }],
    }),
    // Return Value lives with the Flow nodes (see controlFlowNodes.ts) — it is a terminal flow node,
    // not a pure data node.
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
        pins: [anyIn("value", "Value"), out("result", "JSON", "json")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_IS_STRING,
        displayName: "Is String",
        keywords: ["type", "check", "string", "text"],
        pins: [anyIn("value", "Value"), out("result", "Result", "boolean")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_IS_NUMBER,
        displayName: "Is Number",
        keywords: ["type", "check", "number", "float", "integer"],
        pins: [anyIn("value", "Value"), out("result", "Result", "boolean")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_IS_BOOLEAN,
        displayName: "Is Boolean",
        keywords: ["type", "check", "boolean", "bool"],
        pins: [anyIn("value", "Value"), out("result", "Result", "boolean")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_IS_ARRAY,
        displayName: "Is Array",
        keywords: ["type", "check", "array", "list", "json"],
        pins: [anyIn("value", "Value"), out("result", "Result", "boolean")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_IS_OBJECT,
        displayName: "Is Object",
        keywords: ["type", "check", "object", "map", "json"],
        pins: [anyIn("value", "Value"), out("result", "Result", "boolean")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_IS_NULL,
        displayName: "Is Null",
        keywords: ["type", "check", "null", "none"],
        pins: [anyIn("value", "Value"), out("result", "Result", "boolean")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_NOT_NULL,
        displayName: "Not Null",
        keywords: ["type", "check", "null", "none", "exists", "defined"],
        pins: [anyIn("value", "Value"), out("result", "Result", "boolean")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_IS_EMPTY_VALUE,
        displayName: "Is Empty Value",
        keywords: ["type", "check", "empty", "blank", "null"],
        pins: [anyIn("value", "Value"), out("result", "Result", "boolean")],
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
        pins: [stringIn("value", "Text"), out("result", "JSON", "json")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
        displayName: "Stringify JSON",
        keywords: ["stringify", "json", "serialize", "string"],
        pins: [jsonIn("value", "JSON"), out("result", "Text", "string")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
        displayName: "Get JSON Field",
        keywords: ["json", "field", "path", "dot", "get", "read"],
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
        pins: [
            jsonIn("json", "JSON"),
            stringIn("path", "Path"),
            out("result", "Exists", "boolean"),
        ],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_JSON_SET,
        displayName: "Set JSON Field",
        keywords: ["json", "field", "path", "dot", "set", "write"],
        pins: [
            jsonIn("json", "JSON"),
            stringIn("path", "Path"),
            anyIn("value", "Value"),
            out("result", "JSON", "json"),
        ],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_JSON_REMOVE,
        displayName: "Remove JSON Field",
        keywords: ["json", "field", "path", "dot", "remove", "delete"],
        pins: [
            jsonIn("json", "JSON"),
            stringIn("path", "Path"),
            out("result", "JSON", "json"),
        ],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
        displayName: "Make JSON Object",
        keywords: ["json", "object", "make", "map", "struct", "field"],
        pins: [out("result", "Object", "json")],
        dynamicInputPins: {
            storageKey: JSON_OBJECT_INPUT_PINS_KEY,
            fixedDataInputIds: [],
            generatedIdPrefix: "field",
            valueType: "any",
            allowInlineLiteral: false,
            generatedPinTemplates: [
                { idSuffix: "name", label: "Name", valueType: "string", allowInlineLiteral: true },
                { idSuffix: "value", label: "Value", valueType: "any", allowInlineLiteral: false },
            ],
            labelPrefix: "Field",
        },
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY,
        displayName: "Make JSON Array",
        keywords: ["json", "array", "make", "list", "items"],
        pins: [out("result", "Array", BLUEPRINT_VALUE_TYPE_ARRAY)],
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
        pins: [
            { id: "value", kind: "input", semantic: "data", valueType: BLUEPRINT_VALUE_TYPE_ARRAY, label: "Array" },
            out("length", "Length", "integer"),
        ],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_JSON_MERGE_OBJECT,
        displayName: "Merge JSON Object",
        keywords: ["json", "object", "merge", "combine"],
        pins: [jsonIn("a", "A"), jsonIn("b", "B"), out("result", "Object", "json")],
    }),
    dataNode({
        type: BLUEPRINT_NODE_TYPE_DATA_JSON_CLONE,
        displayName: "Clone JSON",
        keywords: ["json", "clone", "copy", "deep"],
        pins: [jsonIn("value", "JSON"), out("result", "JSON", "json")],
    }),
];
