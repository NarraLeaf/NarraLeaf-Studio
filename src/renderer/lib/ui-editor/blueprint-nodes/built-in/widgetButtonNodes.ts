/**
 * Button (and similar) appearance: variant override on an element.
 * Comments in English per project convention.
 */

import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";
import { requireHostApi } from "./hostApi";

export const widgetButtonBlueprintNodes: BlueprintNodeDef[] = [
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
