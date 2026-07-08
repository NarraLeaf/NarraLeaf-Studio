import type {
    StoryBlock,
    StoryDisplayableBuiltin,
    StoryDisplayableTargetKind,
    StoryDisplayableTargetRef,
    StoryScene,
} from "./document";

/** Author-facing label + transform kind for each built-in stage singleton. */
export const DISPLAYABLE_BUILTIN_META: Record<StoryDisplayableBuiltin, { label: string; kind: StoryDisplayableTargetKind; hint: string }> = {
    background: { label: "Scene background", kind: "image", hint: "The scene's background image" },
    backgroundLayer: { label: "Background layer", kind: "layer", hint: "Built-in layer, behind everything" },
    displayableLayer: { label: "Displayable layer", kind: "layer", hint: "Built-in default layer" },
};

/**
 * The kind + *current* stage name of the displayable a creator action block introduces, or null
 * when the block does not declare a displayable. Character / image / text / layer actions are the
 * only ways a displayable comes into existence, so these are the only sources of a stable identity.
 */
export function displayableSourceIdentity(block: StoryBlock): { kind: StoryDisplayableTargetKind; name: string } | null {
    if (block.kind !== "action") {
        return null;
    }
    const payload = block.payload;
    if (payload.action === "character") {
        return { kind: "character", name: payload.objectName || "Character" };
    }
    if (payload.action === "image") {
        return { kind: "image", name: payload.objectName || "Image" };
    }
    if (payload.action === "text") {
        return { kind: "text", name: payload.objectName || "Text" };
    }
    if (payload.action === "layer") {
        // Only a `create` op introduces a layer; other ops (transform / z-index / show / hide)
        // reference an existing one via `target`, so they are not a source of stage identity.
        return payload.operation === "create" ? { kind: "layer", name: payload.objectName || "Layer" } : null;
    }
    return null;
}

/**
 * Resolve a displayable target to the name + kind that should be used *right now*. When the target
 * carries a stable `sourceBlockId` that still resolves to a creator block, that block's current
 * stage name wins, so the reference follows renames. Otherwise the stored `name`/`kind` is returned
 * — for legacy documents authored before stable ids, or a source block that was deleted.
 */
export function resolveDisplayableTargetRef(
    scene: StoryScene | null | undefined,
    target: StoryDisplayableTargetRef,
): { name: string; kind?: StoryDisplayableTargetKind } {
    if (target.builtin) {
        const meta = DISPLAYABLE_BUILTIN_META[target.builtin];
        return { name: meta.label, kind: meta.kind };
    }
    if (target.sourceBlockId) {
        const source = scene?.blocks[target.sourceBlockId];
        const identity = source ? displayableSourceIdentity(source) : null;
        if (identity) {
            return { name: identity.name, kind: identity.kind };
        }
    }
    return { name: target.name ?? "", kind: target.kind };
}
