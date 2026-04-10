/**
 * Pure math nodes: operands from wired data pins A/B or on-card float literals (params a/b) when unwired.
 * Values flow through resolveDataPinValue.
 */

import {
    BLUEPRINT_NODE_TYPE_MATH_ADD,
    BLUEPRINT_NODE_TYPE_MATH_DECREMENT,
    BLUEPRINT_NODE_TYPE_MATH_DIVIDE,
    BLUEPRINT_NODE_TYPE_MATH_INCREMENT,
    BLUEPRINT_NODE_TYPE_MATH_MULTIPLY,
    BLUEPRINT_NODE_TYPE_MATH_SUBTRACT,
} from "@shared/types/blueprint/graph";
import type { BlueprintNodeDef } from "../types";

const MATH_PIN_A = {
    id: "a",
    kind: "input" as const,
    semantic: "data" as const,
    valueType: "float" as const,
    label: "A",
    allowInlineLiteral: true,
};
const MATH_PIN_B = {
    id: "b",
    kind: "input" as const,
    semantic: "data" as const,
    valueType: "float" as const,
    label: "B",
    allowInlineLiteral: true,
};
const MATH_PIN_RESULT = {
    id: "result",
    kind: "output" as const,
    semantic: "data" as const,
    valueType: "float" as const,
    label: "Result",
};

const MATH_UNARY_VALUE_IN = {
    id: "value",
    kind: "input" as const,
    semantic: "data" as const,
    valueType: "float" as const,
    label: "Value",
    allowInlineLiteral: true,
};

export const mathBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_MATH_ADD,
        displayName: "Add",
        category: "Math",
        keywords: ["add", "plus", "sum", "+"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        pins: [MATH_PIN_A, MATH_PIN_B, MATH_PIN_RESULT],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_SUBTRACT,
        displayName: "Subtract",
        category: "Math",
        keywords: ["subtract", "minus", "difference", "-"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        pins: [MATH_PIN_A, MATH_PIN_B, MATH_PIN_RESULT],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_MULTIPLY,
        displayName: "Multiply",
        category: "Math",
        keywords: ["multiply", "product", "times", "*"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        pins: [MATH_PIN_A, MATH_PIN_B, MATH_PIN_RESULT],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_DIVIDE,
        displayName: "Divide",
        category: "Math",
        keywords: ["divide", "division", "/"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        pins: [MATH_PIN_A, MATH_PIN_B, MATH_PIN_RESULT],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_INCREMENT,
        displayName: "Increment (++)",
        category: "Math",
        keywords: ["increment", "++", "plus one", "add one"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        pins: [MATH_UNARY_VALUE_IN, MATH_PIN_RESULT],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_DECREMENT,
        displayName: "Decrement (--)",
        category: "Math",
        keywords: ["decrement", "--", "minus one", "subtract one"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        pins: [MATH_UNARY_VALUE_IN, MATH_PIN_RESULT],
        execute: () => ({}),
    },
];
