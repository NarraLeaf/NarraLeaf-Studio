/**
 * Graph structure: entry heads, layout reroute, data literal.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_REROUTE,
} from "@shared/types/blueprint/graph";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";

const eventHeadExecute: BlueprintNodeDef["execute"] = () => ({ nextPort: "then" });

export const structuralBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
        displayName: "On widget initialize",
        category: "Events",
        keywords: ["init", "initialize", "mount", "start", "begin"],
        graphKinds: ["event"],
        isPure: false,
        role: "eventHead",
        pins: [{ id: "then", kind: "output", semantic: "exec", label: "Then" }],
        execute: eventHeadExecute,
    },
    {
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_CLICK,
        displayName: "On button click",
        category: "Events",
        keywords: ["click", "button", "tap", "press"],
        graphKinds: ["event"],
        isPure: false,
        role: "eventHead",
        scope: { widgetElementTypes: ["nl.button"] },
        pins: [{ id: "then", kind: "output", semantic: "exec", label: "Then" }],
        execute: eventHeadExecute,
    },
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
        type: BLUEPRINT_NODE_TYPE_REROUTE,
        displayName: "Reroute",
        category: "Layout",
        keywords: ["reroute", "wire", "organize"],
        graphKinds: ["event", "function", "macro"],
        isPure: false,
        role: "reroute",
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "out", kind: "output", semantic: "exec", label: "Out" },
        ],
        execute: () => ({ nextPort: "out" }),
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
