/**
 * Generic widget element visibility and interaction (by element id).
 * Comments in English per project convention.
 */

import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";
import { requireHostApi } from "./hostApi";

export const widgetElementBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: "blueprint.widget.setVisible",
        displayName: "Set visible",
        category: "Widget",
        keywords: ["visible", "show", "hide"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        inspectorParams: [
            { key: "elementId", label: "Element id", kind: "string" },
            { key: "visible", label: "Visible (JSON)", kind: "json" },
        ],
        scope: { ownerKinds: ["widgetMain"] },
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const elementId = String(ctx.params.elementId ?? "").trim();
            const visible = Boolean(ctx.params.visible ?? true);
            if (!elementId) {
                throw new BlueprintGraphExecutionError("blueprint.widget.setVisible requires params.elementId", ctx.node.id);
            }
            await api.widget.setVisible(elementId, visible);
            return { nextPort: "next" };
        },
    },
    {
        type: "blueprint.widget.setEnabled",
        displayName: "Set enabled",
        category: "Widget",
        keywords: ["enabled", "disabled", "interaction"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        inspectorParams: [
            { key: "elementId", label: "Element id", kind: "string" },
            { key: "enabled", label: "Enabled (JSON)", kind: "json" },
        ],
        scope: { ownerKinds: ["widgetMain"] },
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const elementId = String(ctx.params.elementId ?? "").trim();
            const enabled = Boolean(ctx.params.enabled ?? true);
            if (!elementId) {
                throw new BlueprintGraphExecutionError("blueprint.widget.setEnabled requires params.elementId", ctx.node.id);
            }
            await api.widget.setEnabled(elementId, enabled);
            return { nextPort: "next" };
        },
    },
];
