/**
 * Host persistence (key/value storage).
 * Comments in English per project convention.
 */

import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";

export const persistenceBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: "blueprint.persistence.set",
        displayName: "Save data",
        category: "Persistence",
        keywords: ["save", "storage", "persistence", "set", "write"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            {
                id: "value",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Value",
                allowInlineLiteral: true,
            },
        ],
        inspectorParams: [
            { key: "key", label: "Key", kind: "string" },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const key = String(ctx.params.key ?? "").trim();
            if (!key) {
                throw new BlueprintGraphExecutionError("Missing key", ctx.node.id);
            }
            const wired = resolveDataPinValue(ctx.graph, ctx.node.id, "value", ctx.params, ctx.blueprintLocals, 0, {
                hostAdapter: ctx.hostAdapter,
                eventPayload: ctx.eventPayload,
                listItemScope: ctx.listItemScope,
                instanceKey: ctx.instanceKey,
                executionOwner: ctx.executionOwner,
            });
            const value = wired !== undefined ? wired : ctx.params.value;
            await api.persistence.set(key, value);
            return { nextPort: "next" };
        },
    },
];
