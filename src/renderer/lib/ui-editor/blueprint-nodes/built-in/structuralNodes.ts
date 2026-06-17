/**
 * Graph structure nodes.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
} from "@shared/types/blueprint/graph";
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
];
