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
        keywords: ["visible", "show", "hide", "element"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        inspectorParams: [
            { key: "elementId", label: "Target element", kind: "select", dynamicOptionsSource: "elements" },
            {
                key: "visible", label: "Visible", kind: "select",
                options: [
                    { value: "true", label: "Show" },
                    { value: "false", label: "Hide" },
                ],
            },
        ],
        scope: { ownerKinds: ["widgetMain"] },
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const elementId = String(ctx.params.elementId ?? "").trim();
            const visible = ctx.params.visible === "false" ? false : Boolean(ctx.params.visible ?? true);
            if (!elementId) {
                throw new BlueprintGraphExecutionError("Pick an element", ctx.node.id);
            }
            await api.widget.setVisible(elementId, visible);
            return { nextPort: "next" };
        },
    },
    {
        type: "blueprint.widget.setEnabled",
        displayName: "Set enabled",
        category: "Widget",
        keywords: ["enabled", "disabled", "interaction", "element"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        inspectorParams: [
            { key: "elementId", label: "Target element", kind: "select", dynamicOptionsSource: "elements" },
            {
                key: "enabled", label: "Enabled", kind: "select",
                options: [
                    { value: "true", label: "Enabled" },
                    { value: "false", label: "Disabled" },
                ],
            },
        ],
        scope: { ownerKinds: ["widgetMain"] },
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const elementId = String(ctx.params.elementId ?? "").trim();
            const enabled = ctx.params.enabled === "false" ? false : Boolean(ctx.params.enabled ?? true);
            if (!elementId) {
                throw new BlueprintGraphExecutionError("Pick an element", ctx.node.id);
            }
            await api.widget.setEnabled(elementId, enabled);
            return { nextPort: "next" };
        },
    },
    {
        type: "blueprint.widget.setVariant",
        displayName: "Set variant",
        category: "Widget",
        keywords: ["variant", "appearance", "container", "button", "element"],
        graphKinds: ["event", "macro"],
        hideInPalette: true,
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        inspectorParams: [
            { key: "elementId", label: "Target element", kind: "select", dynamicOptionsSource: "elements" },
        ],
        scope: { ownerKinds: ["widgetMain"] },
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const elementId = String(ctx.params.elementId ?? "").trim();
            if (!elementId) {
                throw new BlueprintGraphExecutionError("Pick an element", ctx.node.id);
            }
            const raw = ctx.params.variantId;
            const variantId = raw == null ? null : String(raw).trim() || null;
            await api.widget.setVariant(elementId, variantId);
            return { nextPort: "next" };
        },
    },
];
