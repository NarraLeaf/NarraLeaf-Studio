/**
 * Control flow nodes.
 * Comments in English per project convention.
 */

import type { BlueprintNodeDef } from "../types";
import { resolveIfCondition } from "./graphParamResolvers";

export const controlFlowBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: "if",
        displayName: "If",
        category: "Flow",
        keywords: ["if", "branch", "condition"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "true", kind: "output", semantic: "exec", label: "True" },
            { id: "false", kind: "output", semantic: "exec", label: "False" },
            { id: "condition", kind: "input", semantic: "data", valueType: "boolean", label: "Condition" },
        ],
        execute: ctx => {
            const conditionValue = resolveIfCondition(ctx.graph, ctx.node, ctx.params, ctx.blueprintLocals, {
                hostAdapter: ctx.hostAdapter,
                eventPayload: ctx.eventPayload,
                executionOwner: ctx.executionOwner,
            });
            const truthy = Boolean(conditionValue);
            return { nextPort: truthy ? "true" : "false" };
        },
    },
];
