/**
 * Host persistence (key/value storage).
 * Comments in English per project convention.
 */

import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";
import { requireHostApi } from "./hostApi";

export const persistenceBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: "blueprint.persistence.set",
        displayName: "Persistence set",
        category: "Persistence",
        keywords: ["save", "storage"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        inspectorParams: [
            { key: "key", label: "Key", kind: "string" },
            { key: "value", label: "Value (JSON)", kind: "json" },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const key = String(ctx.params.key ?? "").trim();
            if (!key) {
                throw new BlueprintGraphExecutionError("blueprint.persistence.set requires params.key", ctx.node.id);
            }
            await api.persistence.set(key, ctx.params.value);
            return { nextPort: "next" };
        },
    },
];
