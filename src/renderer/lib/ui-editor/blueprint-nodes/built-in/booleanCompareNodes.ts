/**
 * Pure boolean logic and value comparison nodes.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_BOOLEAN_AND,
    BLUEPRINT_NODE_TYPE_BOOLEAN_NOT,
    BLUEPRINT_NODE_TYPE_BOOLEAN_OR,
    BLUEPRINT_NODE_TYPE_BOOLEAN_XOR,
    BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN,
    BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN,
    BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL,
} from "@shared/types/blueprint/graph";
import type { TranslationKey } from "@shared/i18n";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";

const GRAPH_KINDS = ["event", "function", "macro"] as const;

const booleanIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "boolean",
    label,
});

const floatIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "float",
    label,
    allowInlineLiteral: true,
});

const anyIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "any",
    label,
});

const booleanOut: BlueprintNodePinDef = {
    id: "result",
    kind: "output",
    semantic: "data",
    valueType: "boolean",
    label: "Result",
};

function pureNode(input: {
    type: string;
    displayName: string;
    description?: TranslationKey;
    keywords: string[];
    pins: BlueprintNodePinDef[];
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        description: input.description,
        category: "Math",
        keywords: input.keywords,
        graphKinds: [...GRAPH_KINDS],
        isPure: true,
        pins: input.pins,
        execute: () => ({}),
    };
}

export const booleanCompareBlueprintNodes: BlueprintNodeDef[] = [
    pureNode({
        type: BLUEPRINT_NODE_TYPE_BOOLEAN_AND,
        displayName: "And",
        keywords: ["and", "boolean", "logic"],
        pins: [booleanIn("a", "A"), booleanIn("b", "B"), booleanOut],
    }),
    pureNode({
        type: BLUEPRINT_NODE_TYPE_BOOLEAN_OR,
        displayName: "Or",
        keywords: ["or", "boolean", "logic"],
        pins: [booleanIn("a", "A"), booleanIn("b", "B"), booleanOut],
    }),
    pureNode({
        type: BLUEPRINT_NODE_TYPE_BOOLEAN_NOT,
        displayName: "Not",
        keywords: ["not", "boolean", "logic", "invert"],
        pins: [booleanIn("a", "Value"), booleanOut],
    }),
    pureNode({
        type: BLUEPRINT_NODE_TYPE_BOOLEAN_XOR,
        displayName: "Xor",
        keywords: ["xor", "exclusive", "boolean", "logic"],
        pins: [booleanIn("a", "A"), booleanIn("b", "B"), booleanOut],
    }),
    // The comparisons the palette offers. Their keywords carry every spelling of the operator an
    // author might type - the symbol, its two-character form and the short names - because these
    // stand alone now that the older symbol-titled `blueprint.math.*` set is kept out of the palette.
    pureNode({
        type: BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
        displayName: "Equal",
        description: "blueprint.nodeDescription.compareEqual",
        keywords: ["equal", "equals", "eq", "strict", "same", "compare", "=", "==", "==="],
        pins: [anyIn("a", "A"), anyIn("b", "B"), booleanOut],
    }),
    pureNode({
        type: BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL,
        displayName: "Not Equal",
        description: "blueprint.nodeDescription.compareNotEqual",
        keywords: ["not equal", "neq", "ne", "strict", "different", "compare", "≠", "!=", "!=="],
        pins: [anyIn("a", "A"), anyIn("b", "B"), booleanOut],
    }),
    pureNode({
        type: BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN,
        displayName: "Greater Than",
        description: "blueprint.nodeDescription.compareGreaterThan",
        keywords: ["greater", "more", "gt", "compare", ">"],
        pins: [floatIn("a", "A"), floatIn("b", "B"), booleanOut],
    }),
    pureNode({
        type: BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL,
        displayName: "Greater Than Or Equal",
        description: "blueprint.nodeDescription.compareGreaterThanOrEqual",
        keywords: ["greater", "equal", "gte", "ge", "compare", ">=", "≥"],
        pins: [floatIn("a", "A"), floatIn("b", "B"), booleanOut],
    }),
    pureNode({
        type: BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN,
        displayName: "Less Than",
        description: "blueprint.nodeDescription.compareLessThan",
        keywords: ["less", "smaller", "lt", "compare", "<"],
        pins: [floatIn("a", "A"), floatIn("b", "B"), booleanOut],
    }),
    pureNode({
        type: BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL,
        displayName: "Less Than Or Equal",
        description: "blueprint.nodeDescription.compareLessThanOrEqual",
        keywords: ["less", "equal", "lte", "le", "compare", "<=", "≤"],
        pins: [floatIn("a", "A"), floatIn("b", "B"), booleanOut],
    }),
];
