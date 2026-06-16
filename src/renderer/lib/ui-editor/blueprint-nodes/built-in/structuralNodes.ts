/**
 * Graph structure: entry heads, data literal.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_NULL,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
} from "@shared/types/blueprint/graph";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";

const dataOnlyExecute: BlueprintNodeDef["execute"] = ctx => {
    throw new BlueprintGraphExecutionError(
        "Literal nodes are data-only and must not sit on the execution path",
        ctx.node.id,
    );
};

export const structuralBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
        displayName: "Function entry",
        category: "Flow",
        keywords: ["function", "entry", "start"],
        graphKinds: ["function"],
        isPure: true,
        role: "functionEntry",
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "then", kind: "output", semantic: "exec", label: "Then" },
        ],
        execute: () => ({ nextPort: "then" }),
    },
    {
        type: BLUEPRINT_NODE_TYPE_LITERAL,
        displayName: "Literal",
        category: "Data",
        keywords: ["literal", "value", "const"],
        graphKinds: ["event", "function", "macro"],
        hideInPalette: true,
        isPure: true,
        role: "dataLiteral",
        pins: [{ id: "value", kind: "output", semantic: "data", valueType: "any", label: "Value" }],
        inspectorParams: [{ key: "value", label: "Value", kind: "literal" }],
        execute: dataOnlyExecute,
    },
    {
        type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
        displayName: "Text",
        category: "Data",
        keywords: ["literal", "string", "text", "value", "const"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        role: "dataLiteral",
        pins: [{ id: "value", kind: "output", semantic: "data", valueType: "string", label: "Text" }],
        inspectorParams: [{ key: "value", label: "Text", kind: "string" }],
        execute: dataOnlyExecute,
    },
    {
        type: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
        displayName: "Number",
        category: "Data",
        keywords: ["literal", "number", "float", "integer", "value", "const"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        role: "dataLiteral",
        pins: [{ id: "value", kind: "output", semantic: "data", valueType: "float", label: "Number" }],
        inspectorParams: [{ key: "value", label: "Number", kind: "number" }],
        execute: dataOnlyExecute,
    },
    {
        type: BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
        displayName: "Boolean",
        category: "Data",
        keywords: ["literal", "boolean", "bool", "true", "false", "value", "const"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        role: "dataLiteral",
        pins: [{ id: "value", kind: "output", semantic: "data", valueType: "boolean", label: "Boolean" }],
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
        execute: dataOnlyExecute,
    },
    {
        type: BLUEPRINT_NODE_TYPE_LITERAL_NULL,
        displayName: "Null",
        category: "Data",
        keywords: ["literal", "null", "none", "empty", "value", "const"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        role: "dataLiteral",
        pins: [{ id: "value", kind: "output", semantic: "data", valueType: "any", label: "Null" }],
        execute: dataOnlyExecute,
    },
    {
        type: BLUEPRINT_NODE_TYPE_LITERAL_JSON,
        displayName: "JSON",
        category: "Data",
        keywords: ["literal", "json", "object", "array", "value", "const"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        role: "dataLiteral",
        pins: [{ id: "value", kind: "output", semantic: "data", valueType: "json", label: "JSON" }],
        inspectorParams: [{ key: "value", label: "JSON", kind: "json" }],
        execute: dataOnlyExecute,
    },
];
