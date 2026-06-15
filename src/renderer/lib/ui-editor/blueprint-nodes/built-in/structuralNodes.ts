/**
 * Graph structure: entry heads, data literal.
 * Comments in English per project convention.
 */

import { BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY, BLUEPRINT_NODE_TYPE_LITERAL } from "@shared/types/blueprint/graph";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";

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
        isPure: true,
        role: "dataLiteral",
        pins: [{ id: "value", kind: "output", semantic: "data", valueType: "any", label: "Value" }],
        inspectorParams: [{ key: "value", label: "Value", kind: "literal" }],
        execute: ctx => {
            throw new BlueprintGraphExecutionError(
                "Literal nodes are data-only and must not sit on the execution path",
                ctx.node.id,
            );
        },
    },
];
