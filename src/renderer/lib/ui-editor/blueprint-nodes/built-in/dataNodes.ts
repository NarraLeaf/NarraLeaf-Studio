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
    inspectorParams?: BlueprintNodeDef["inspectorParams"];
    role?: BlueprintNodeDef["role"];
    hideInPalette?: boolean;
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: "Data",
        keywords: input.keywords,
        graphKinds: [...GRAPH_KINDS],
        hideInPalette: input.hideInPalette,
        isPure: true,
        role: input.role,
        pins: input.pins,
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
];
