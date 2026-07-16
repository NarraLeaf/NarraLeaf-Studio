import type {
    StoryActionPayload,
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

/** Fallback stage name for a displayable whose `objectName` is blank. Mirrors the compiler. */
export function normalizeStageObjectName(value: string | undefined): string {
    return value?.trim() || "object";
}

/**
 * The stage name a `character` action registers its portrait under. A character has no dedicated
 * name field, so an author who never touches the stage name still needs a stable key: `characterId`
 * stands in. The literal `"character"` is treated as unset because it is the bare-block default,
 * not an authored choice.
 *
 * This is THE rule for character stage naming — the compiler, the stage snapshot and every target
 * reference resolve through it, so they cannot drift apart. See `displayableSourceIdentity`.
 */
export function characterStageObjectName(payload: Extract<StoryActionPayload, { action: "character" }>): string {
    const explicitName = payload.objectName?.trim();
    if (explicitName && explicitName !== "character") {
        return normalizeStageObjectName(explicitName);
    }
    return normalizeStageObjectName(payload.characterId || explicitName || "character");
}

/**
 * The identity of the displayable a creator action block introduces, or null when the block does not
 * declare one. Character / image / text / layer actions are the only ways a displayable comes into
 * existence, so these are the only sources of a stable identity.
 *
 * `name` is the *stage key*: the exact name the compiler registers the object under. Resolution must
 * use it, or the lookup misses and the action silently does nothing.
 *
 * `label` is the *author-facing* name and is the only one safe to render: a character with no stage
 * name keys on its `characterId`, which is a UUID and must never reach the UI.
 */
export function displayableSourceIdentity(
    block: StoryBlock,
): { kind: StoryDisplayableTargetKind; name: string; label: string } | null {
    if (block.kind !== "action") {
        return null;
    }
    const payload = block.payload;
    if (payload.action === "character") {
        return { kind: "character", name: characterStageObjectName(payload), label: payload.objectName?.trim() || "Character" };
    }
    if (payload.action === "image") {
        return { kind: "image", name: normalizeStageObjectName(payload.objectName), label: payload.objectName?.trim() || "Image" };
    }
    if (payload.action === "text") {
        return { kind: "text", name: normalizeStageObjectName(payload.objectName), label: payload.objectName?.trim() || "Text" };
    }
    if (payload.action === "layer") {
        // Only a `create` op introduces a layer; other ops (transform / z-index / show / hide)
        // reference an existing one via `target`, so they are not a source of stage identity.
        return payload.operation === "create"
            ? { kind: "layer", name: normalizeStageObjectName(payload.objectName), label: payload.objectName?.trim() || "Layer" }
            : null;
    }
    return null;
}

/**
 * Resolve a displayable target to the stage key + kind that should be used *right now*. When the
 * target carries a stable `sourceBlockId` that still resolves to a creator block, that block's
 * current identity wins, so the reference follows renames. Otherwise the stored `name`/`kind` is
 * returned — for legacy documents authored before stable ids, or a source block that was deleted.
 *
 * Look objects up by `name` and render `label`; they differ whenever the stage key is not something
 * an author typed (see `displayableSourceIdentity`).
 */
export function resolveDisplayableTargetRef(
    scene: StoryScene | null | undefined,
    target: StoryDisplayableTargetRef,
): { name: string; kind?: StoryDisplayableTargetKind; label: string } {
    if (target.builtin) {
        const meta = DISPLAYABLE_BUILTIN_META[target.builtin];
        return { name: meta.label, kind: meta.kind, label: meta.label };
    }
    if (target.sourceBlockId) {
        const source = scene?.blocks[target.sourceBlockId];
        const identity = source ? displayableSourceIdentity(source) : null;
        if (identity) {
            return { name: identity.name, kind: identity.kind, label: identity.label };
        }
    }
    // Legacy / dangling ref: the stored name is all we have, and it is what the author last saw.
    return { name: target.name ?? "", kind: target.kind, label: target.name ?? "" };
}
