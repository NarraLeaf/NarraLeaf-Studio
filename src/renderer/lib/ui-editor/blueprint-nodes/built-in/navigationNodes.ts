/**
 * Host navigation: surfaces and layers.
 * Comments in English per project convention.
 */

import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";
import { requireHostApi } from "./hostApi";

export const navigationBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: "blueprint.navigation.openSurface",
        displayName: "Open surface",
        category: "Navigation",
        keywords: ["nav", "surface", "open"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        inspectorParams: [{ key: "surfaceId", label: "Surface id", kind: "string" }],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const surfaceId = String(ctx.params.surfaceId ?? "").trim();
            if (!surfaceId) {
                throw new BlueprintGraphExecutionError("blueprint.navigation.openSurface requires params.surfaceId", ctx.node.id);
            }
            await api.navigation.openSurface(surfaceId);
            return { nextPort: "next" };
        },
    },
    {
        type: "blueprint.navigation.closeLayer",
        displayName: "Close layer",
        category: "Navigation",
        keywords: ["nav", "close", "layer", "back"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            await api.navigation.closeLayer();
            return { nextPort: "next" };
        },
    },
];
