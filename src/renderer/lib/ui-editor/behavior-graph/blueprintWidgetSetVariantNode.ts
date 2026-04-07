import type { BehaviorNodeDefinition } from "./BehaviorNodeRegistry";
import { BlueprintGraphExecutionError } from "./GraphExecutionError";

function requireHostApi(ctx: Parameters<BehaviorNodeDefinition["execute"]>[0]) {
    const api = ctx.hostAdapter.blueprintRuntime?.hostApi;
    if (!api) {
        throw new BlueprintGraphExecutionError("Blueprint host API is not available (open Dev Mode)", ctx.node.id);
    }
    return api;
}

export const blueprintWidgetSetVariantNode: BehaviorNodeDefinition = {
    type: "blueprint.widget.setVariant",
    displayName: "Set widget variant",
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
};
