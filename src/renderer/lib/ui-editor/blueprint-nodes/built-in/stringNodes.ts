/**
 * Pure string utility nodes: operands from wired data pins or on-card string literals when unwired.
 * Values flow through resolveDataPinValue.
 */

import {
    BLUEPRINT_NODE_TYPE_STRING_CONCAT,
    BLUEPRINT_NODE_TYPE_STRING_LENGTH,
    BLUEPRINT_NODE_TYPE_STRING_TO_LOWER,
    BLUEPRINT_NODE_TYPE_STRING_TO_UPPER,
    BLUEPRINT_NODE_TYPE_STRING_TRIM,
} from "@shared/types/blueprint/graph";
import type { BlueprintNodeDef } from "../types";

const STRING_PIN_A = {
    id: "a",
    kind: "input" as const,
    semantic: "data" as const,
    valueType: "string" as const,
    label: "A",
    allowInlineLiteral: true,
};
const STRING_PIN_B = {
    id: "b",
    kind: "input" as const,
    semantic: "data" as const,
    valueType: "string" as const,
    label: "B",
    allowInlineLiteral: true,
};
const STRING_PIN_VALUE = {
    id: "value",
    kind: "input" as const,
    semantic: "data" as const,
    valueType: "string" as const,
    label: "Value",
    allowInlineLiteral: true,
};
const STRING_PIN_RESULT = {
    id: "result",
    kind: "output" as const,
    semantic: "data" as const,
    valueType: "string" as const,
    label: "Result",
};
const STRING_PIN_LENGTH_RESULT = {
    id: "result",
    kind: "output" as const,
    semantic: "data" as const,
    valueType: "integer" as const,
    label: "Length",
};

export const stringBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_STRING_CONCAT,
        displayName: "Concat",
        category: "String",
        keywords: ["concat", "join", "append", "+", "string"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        pins: [STRING_PIN_A, STRING_PIN_B, STRING_PIN_RESULT],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_STRING_LENGTH,
        displayName: "Length",
        category: "String",
        keywords: ["length", "size", "len", "string"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        pins: [STRING_PIN_VALUE, STRING_PIN_LENGTH_RESULT],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_STRING_TRIM,
        displayName: "Trim",
        category: "String",
        keywords: ["trim", "strip", "whitespace", "string"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        pins: [STRING_PIN_VALUE, STRING_PIN_RESULT],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_STRING_TO_UPPER,
        displayName: "To uppercase",
        category: "String",
        keywords: ["uppercase", "upper", "toUpperCase", "string"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        pins: [STRING_PIN_VALUE, STRING_PIN_RESULT],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_STRING_TO_LOWER,
        displayName: "To lowercase",
        category: "String",
        keywords: ["lowercase", "lower", "toLowerCase", "string"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        pins: [STRING_PIN_VALUE, STRING_PIN_RESULT],
        execute: () => ({}),
    },
];
