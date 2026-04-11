/**
 * Host-driven widget mutations (visibility, interaction, appearance).
 * Comments in English per project convention.
 */

import { BlueprintGraphExecutionError } from "../../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../../types";
import { requireHostApi } from "../hostApi";

export const widgetHostBlueprintNodes: BlueprintNodeDef[] = [
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
    {
        type: "blueprint.widget.setVariant",
        displayName: "Set widget variant",
        category: "Widget",
        keywords: ["variant", "appearance", "container", "button"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        inspectorParams: [
            { key: "elementId", label: "Element id", kind: "string" },
            { key: "variantId", label: "Variant id (JSON null clears)", kind: "json" },
        ],
        scope: { ownerKinds: ["widgetMain"] },
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const elementId = String(ctx.params.elementId ?? "").trim();
            if (!elementId) {
                throw new BlueprintGraphExecutionError("blueprint.widget.setVariant requires params.elementId", ctx.node.id);
            }
            const raw = ctx.params.variantId;
            if (raw === undefined) {
                throw new BlueprintGraphExecutionError(
                    "blueprint.widget.setVariant requires params.variantId (string, or JSON null to clear override)",
                    ctx.node.id,
                );
            }
            const variantId = raw === null ? null : String(raw).trim() || null;
            await api.widget.setVariant(elementId, variantId);
            return { nextPort: "next" };
        },
    },
];
