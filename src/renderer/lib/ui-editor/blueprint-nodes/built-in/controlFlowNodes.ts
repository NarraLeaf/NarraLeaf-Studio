/**
 * Control flow: branch, delay.
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
        execute: ({ params, graph, node, blueprintLocals }) => {
            const conditionValue = resolveIfCondition(graph, node, params, blueprintLocals);
            const truthy = Boolean(conditionValue);
            return { nextPort: truthy ? "true" : "false" };
        },
    },
    {
        type: "delay",
        displayName: "Delay",
        category: "Flow",
        keywords: ["delay", "wait"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        inspectorParams: [{ key: "duration", label: "Duration (ms)", kind: "number" }],
        async execute({ params }) {
            const duration = Math.max(0, Number(params.duration ?? 0));
            if (duration > 0) {
                await new Promise(resolve => setTimeout(resolve, duration));
            }
            return { nextPort: "next" };
        },
    },
];
