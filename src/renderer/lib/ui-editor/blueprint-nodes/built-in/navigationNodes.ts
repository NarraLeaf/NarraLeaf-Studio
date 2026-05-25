/**
 * Host navigation nodes: surface navigation (open / close layer).
 * Comments in English per project convention.
 */

import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";
import { requireHostApi } from "./hostApi";

export const navigationBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: "blueprint.navigation.openSurface",
        displayName: "Open page",
        category: "Navigation",
        keywords: ["navigate", "open", "page", "surface", "go", "push"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        inspectorParams: [
            {
                key: "surfaceId",
                label: "Target page",
                kind: "select",
                dynamicOptionsSource: "surfaces",
            },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const surfaceId = String(ctx.params.surfaceId ?? "").trim();
            if (!surfaceId) {
                throw new BlueprintGraphExecutionError("Pick a page", ctx.node.id);
            }
            await api.navigation.openSurface(surfaceId);
            return { nextPort: "next" };
        },
    },
    {
        type: "blueprint.navigation.closeLayer",
        displayName: "Go back",
        category: "Navigation",
        keywords: ["close", "back", "pop", "return", "previous"],
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
