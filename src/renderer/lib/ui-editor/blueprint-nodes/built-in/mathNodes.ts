/**
 * Pure math nodes: operands from wired data pins A/B or on-card float literals (params a/b) when unwired.
 * Unary add-one / subtract-one use pin `value` (one float in, float `result` out). Comparison nodes output boolean on `result`.
 * Values flow through resolveDataPinValue.
 */

import {
    BLUEPRINT_NODE_TYPE_MATH_ABS,
    BLUEPRINT_NODE_TYPE_MATH_ADD,
    BLUEPRINT_NODE_TYPE_MATH_CEIL,
    BLUEPRINT_NODE_TYPE_MATH_DECREMENT,
    BLUEPRINT_NODE_TYPE_MATH_DIVIDE,
    BLUEPRINT_NODE_TYPE_MATH_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_FLOOR,
    BLUEPRINT_NODE_TYPE_MATH_GREATER,
    BLUEPRINT_NODE_TYPE_MATH_GREATER_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_INCREMENT,
    BLUEPRINT_NODE_TYPE_MATH_LESS,
    BLUEPRINT_NODE_TYPE_MATH_LESS_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_MAX,
    BLUEPRINT_NODE_TYPE_MATH_MIN,
    BLUEPRINT_NODE_TYPE_MATH_MODULO,
    BLUEPRINT_NODE_TYPE_MATH_MULTIPLY,
    BLUEPRINT_NODE_TYPE_MATH_NOT_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_RANDOM_FLOAT,
    BLUEPRINT_NODE_TYPE_MATH_RANDOM_INTEGER,
    BLUEPRINT_NODE_TYPE_MATH_ROUND,
    BLUEPRINT_NODE_TYPE_MATH_SUBTRACT,
} from "@shared/types/blueprint/graph";
import { BLUEPRINT_NODE_PARAMS_DYNAMIC_INPUT_PIN_IDS_KEY, type BlueprintNodeDef } from "../types";

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
const MATH_PIN_RESULT_FLOAT = {
    id: "result",
    kind: "output" as const,
    semantic: "data" as const,
    valueType: "float" as const,
    label: "Result",
};
const MATH_PIN_RESULT_INTEGER = {
    id: "result",
    kind: "output" as const,
    semantic: "data" as const,
    valueType: "integer" as const,
    label: "Result",
};
const MATH_PIN_RESULT_BOOL = {
    id: "result",
    kind: "output" as const,
    semantic: "data" as const,
    valueType: "boolean" as const,
    label: "Result",
};
const MATH_UNARY_NUMBER_IN = {
    id: "value",
    kind: "input" as const,
    semantic: "data" as const,
    valueType: "float" as const,
    label: "Number",
    allowInlineLiteral: true,
};

const GRAPH_KINDS = ["event", "function", "macro"] as const;

const ARITH_NODES: Array<Pick<BlueprintNodeDef, "type" | "displayName" | "keywords">> = [
    {
        type: BLUEPRINT_NODE_TYPE_MATH_ADD,
        displayName: "+",
        keywords: ["add", "plus", "sum", "+"],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_SUBTRACT,
        displayName: "−",
        keywords: ["subtract", "minus", "difference", "-"],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_MULTIPLY,
        displayName: "×",
        keywords: ["multiply", "product", "times", "*"],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_DIVIDE,
        displayName: "÷",
        keywords: ["divide", "division", "/"],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_MODULO,
        displayName: "Modulo",
        keywords: ["modulo", "remainder", "%"],
    },
];

const UNARY_NODES: Array<Pick<BlueprintNodeDef, "type" | "displayName" | "keywords">> = [
    {
        type: BLUEPRINT_NODE_TYPE_MATH_INCREMENT,
        displayName: "+1",
        keywords: ["+1", "add one", "plus one", "increment"],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_DECREMENT,
        displayName: "−1",
        keywords: ["-1", "subtract one", "minus one", "decrement"],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_ABS,
        displayName: "Abs",
        keywords: ["abs", "absolute", "magnitude"],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_ROUND,
        displayName: "Round",
        keywords: ["round", "nearest", "integer"],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_FLOOR,
        displayName: "Floor",
        keywords: ["floor", "down", "integer"],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_CEIL,
        displayName: "Ceil",
        keywords: ["ceil", "ceiling", "up", "integer"],
    },
];

const MIN_MAX_NODES: Array<Pick<BlueprintNodeDef, "type" | "displayName" | "keywords">> = [
    {
        type: BLUEPRINT_NODE_TYPE_MATH_MIN,
        displayName: "Min",
        keywords: ["min", "minimum", "smaller"],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_MAX,
        displayName: "Max",
        keywords: ["max", "maximum", "larger"],
    },
];

const COMPARE_NODES: Array<Pick<BlueprintNodeDef, "type" | "displayName" | "keywords">> = [
    {
        type: BLUEPRINT_NODE_TYPE_MATH_EQUAL,
        displayName: "=",
        keywords: ["equal", "eq", "=="],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_NOT_EQUAL,
        displayName: "≠",
        keywords: ["not equal", "neq", "!=", "<>"],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_LESS,
        displayName: "<",
        keywords: ["less", "lt", "<"],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_LESS_OR_EQUAL,
        displayName: "≤",
        keywords: ["less or equal", "lte", "<="],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_GREATER,
        displayName: ">",
        keywords: ["greater", "gt", ">"],
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_GREATER_OR_EQUAL,
        displayName: "≥",
        keywords: ["greater or equal", "gte", ">="],
    },
];

const INTEGER_RESULT_UNARY_NODE_TYPES = new Set<string>([
    BLUEPRINT_NODE_TYPE_MATH_ROUND,
    BLUEPRINT_NODE_TYPE_MATH_FLOOR,
    BLUEPRINT_NODE_TYPE_MATH_CEIL,
]);

export const mathBlueprintNodes: BlueprintNodeDef[] = [
    ...ARITH_NODES.map(def => ({
        ...def,
        category: "Math",
        graphKinds: [...GRAPH_KINDS],
        isPure: true,
        pins: [MATH_PIN_A, MATH_PIN_B, MATH_PIN_RESULT_FLOAT],
        ...(def.type === BLUEPRINT_NODE_TYPE_MATH_ADD
            ? {
                  dynamicInputPins: {
                      storageKey: BLUEPRINT_NODE_PARAMS_DYNAMIC_INPUT_PIN_IDS_KEY,
                      fixedDataInputIds: ["a", "b"],
                      generatedIdPrefix: "in",
                      valueType: "float",
                      allowInlineLiteral: true,
                  },
              }
            : {}),
        execute: () => ({}),
    })),
    ...UNARY_NODES.map(def => ({
        ...def,
        category: "Math",
        graphKinds: [...GRAPH_KINDS],
        isPure: true,
        pins: [
            MATH_UNARY_NUMBER_IN,
            INTEGER_RESULT_UNARY_NODE_TYPES.has(def.type) ? MATH_PIN_RESULT_INTEGER : MATH_PIN_RESULT_FLOAT,
        ],
        execute: () => ({}),
    })),
    ...MIN_MAX_NODES.map(def => ({
        ...def,
        category: "Math",
        graphKinds: [...GRAPH_KINDS],
        isPure: true,
        pins: [MATH_PIN_A, MATH_PIN_B, MATH_PIN_RESULT_FLOAT],
        dynamicInputPins: {
            storageKey: BLUEPRINT_NODE_PARAMS_DYNAMIC_INPUT_PIN_IDS_KEY,
            fixedDataInputIds: ["a", "b"],
            generatedIdPrefix: "in",
            valueType: "float",
            allowInlineLiteral: true,
        },
        execute: () => ({}),
    })),
    {
        type: BLUEPRINT_NODE_TYPE_MATH_RANDOM_FLOAT,
        displayName: "Random Float",
        category: "Math",
        keywords: ["random", "float", "range"],
        graphKinds: [...GRAPH_KINDS],
        isPure: true,
        pins: [
            { ...MATH_PIN_A, id: "min", label: "Min" },
            { ...MATH_PIN_B, id: "max", label: "Max" },
            MATH_PIN_RESULT_FLOAT,
        ],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_MATH_RANDOM_INTEGER,
        displayName: "Random Integer",
        category: "Math",
        keywords: ["random", "integer", "int", "range"],
        graphKinds: [...GRAPH_KINDS],
        isPure: true,
        pins: [
            { ...MATH_PIN_A, id: "min", label: "Min", valueType: "integer" },
            { ...MATH_PIN_B, id: "max", label: "Max", valueType: "integer" },
            MATH_PIN_RESULT_INTEGER,
        ],
        execute: () => ({}),
    },
    ...COMPARE_NODES.map(def => ({
        ...def,
        category: "Math",
        graphKinds: [...GRAPH_KINDS],
        isPure: true,
        pins: [MATH_PIN_A, MATH_PIN_B, MATH_PIN_RESULT_BOOL],
        execute: () => ({}),
    })),
];
