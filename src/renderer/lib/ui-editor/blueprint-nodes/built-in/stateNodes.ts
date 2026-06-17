/**
 * Host state nodes: scope-aware get/set for surface, global, and persistence state.
 * Comments in English per project convention.
 */

import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";

type StateScope = "surface" | "global";

const SCOPE_OPTIONS = [
    { value: "surface", label: "Page" },
    { value: "global", label: "App" },
] as const;

function resolveScope(raw: unknown): StateScope {
    const s = String(raw ?? "surface").trim().toLowerCase();
    if (s === "global") {
        return "global";
    }
    return "surface";
}

export const stateBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: "blueprint.state.get",
        displayName: "Get state",
        category: "State",
        keywords: ["state", "get", "read", "variable", "data"],
        graphKinds: ["event", "macro", "function"],
        isPure: true,
        pins: [
            {
                id: "result",
                kind: "output",
                semantic: "data",
                valueType: "any",
                label: "Value",
            },
        ],
        inspectorParams: [
            { key: "scope", label: "Scope", kind: "select", options: [...SCOPE_OPTIONS] },
            { key: "key", label: "Key", kind: "string" },
        ],
        execute(ctx) {
            const api = requireHostApi(ctx);
            const scope = resolveScope(ctx.params.scope);
            const key = String(ctx.params.key ?? "").trim();
            if (!key) {
                throw new BlueprintGraphExecutionError("Missing key", ctx.node.id);
            }
            const value = api.state.get(scope, key);
            return { nextPort: undefined, outputValues: { result: value } };
        },
    },
    {
        type: "blueprint.state.set",
        displayName: "Set state",
        category: "State",
        keywords: ["state", "set", "write", "variable", "data", "update"],
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
            { key: "scope", label: "Scope", kind: "select", options: [...SCOPE_OPTIONS] },
            { key: "key", label: "Key", kind: "string" },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const scope = resolveScope(ctx.params.scope);
            const key = String(ctx.params.key ?? "").trim();
            if (!key) {
                throw new BlueprintGraphExecutionError("Missing key", ctx.node.id);
            }
            const wired = resolveDataPinValue(ctx.graph, ctx.node.id, "value", ctx.params, ctx.blueprintLocals, 0, {
                hostAdapter: ctx.hostAdapter,
                eventPayload: ctx.eventPayload,
                executionOwner: ctx.executionOwner,
            });
            const value = wired !== undefined ? wired : ctx.params.value;
            await api.state.set(scope, key, value);
            return { nextPort: "next" };
        },
    },
    {
        type: "blueprint.persistence.get",
        displayName: "Get saved data",
        category: "Persistence",
        keywords: ["persistence", "get", "load", "storage", "saved"],
        graphKinds: ["event", "macro", "function"],
        isPure: true,
        pins: [
            {
                id: "result",
                kind: "output",
                semantic: "data",
                valueType: "any",
                label: "Value",
            },
        ],
        inspectorParams: [{ key: "key", label: "Key", kind: "string" }],
        execute(ctx) {
            const api = requireHostApi(ctx);
            const key = String(ctx.params.key ?? "").trim();
            if (!key) {
                throw new BlueprintGraphExecutionError("Missing key", ctx.node.id);
            }
            const value = api.persistence.get(key);
            return { nextPort: undefined, outputValues: { result: value } };
        },
    },
];
