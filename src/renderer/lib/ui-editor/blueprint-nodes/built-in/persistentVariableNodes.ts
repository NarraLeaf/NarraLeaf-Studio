/**
 * Project-level persistent variables backed by host-managed storage.
 * Comments in English per project convention.
 */

import type { LiteralValue } from "@shared/types/blueprint/document";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import {
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
} from "@shared/types/blueprint/graph";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";
import { resolveNodeInput } from "./graphParamResolvers";
import { requireHostApi } from "./hostApi";
import { persistentStateKey } from "../../blueprint-runtime/blueprintStateWrites";

function cloneLiteralValue(value: LiteralValue | undefined): unknown {
    if (value === undefined) {
        return undefined;
    }
    if (typeof structuredClone === "function") {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value)) as unknown;
}

function resolvePersistentVariable(
    ctx: Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0],
): VariableRegistryEntry {
    const id = String(ctx.params.persistentVariableId ?? "").trim();
    if (!id) {
        throw new BlueprintGraphExecutionError("Pick a persistent variable", ctx.node.id);
    }
    const variable = ctx.persistentVariables?.[id];
    if (!variable) {
        throw new BlueprintGraphExecutionError("Persistent variable not found", ctx.node.id);
    }
    if (!variable.storageKey.trim()) {
        throw new BlueprintGraphExecutionError("Persistent variable storage key is empty", ctx.node.id);
    }
    return variable;
}

export const persistentVariableBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
        displayName: "Get Persistent",
        category: "Variables",
        keywords: ["get", "persistent", "storage", "save", "load", "setting"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            {
                id: "value",
                kind: "output",
                semantic: "data",
                valueType: "any",
                label: "Value",
            },
        ],
        inspectorParams: [{ key: "persistentVariableId", label: "Persistent", kind: "persistentVariableRef" }],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const variable = resolvePersistentVariable(ctx);
            // A value binding that reaches this through a Fn shows the value; it has to hear the
            // next write to it.
            ctx.valueExecution?.trackState?.(persistentStateKey(variable.storageKey));
            const stored = await api.persistence.get(variable.storageKey);
            return {
                nextPort: "next",
                outputValues: {
                    value: stored === undefined ? cloneLiteralValue(variable.defaultValue) : stored,
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
        displayName: "Set Persistent",
        category: "Variables",
        keywords: ["set", "persistent", "storage", "save", "write", "setting"],
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
                valueType: "any",
                label: "Value",
            },
        ],
        inspectorParams: [{ key: "persistentVariableId", label: "Persistent", kind: "persistentVariableRef" }],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const variable = resolvePersistentVariable(ctx);
            const value = resolveNodeInput(ctx, "value");
            await api.persistence.set(variable.storageKey, value);
            return { nextPort: "next" };
        },
    },
];
