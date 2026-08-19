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
 * This is THE rule for character stage naming - the compiler, the stage snapshot and every target
 * reference resolve through it, so they cannot drift apart. See `displayableSourceIdentity`.
 */
export function characterStageObjectName(payload: Extract<StoryActionPayload, { action: "character" }>): string {
    return characterStageName(payload.characterId, payload.objectName);
}

/**
 * The stage name rule itself, keyed on the two fields it actually needs. Extracted so callers that
 * hold a bare `characterId` (an inline expression run carries only that - see the compiler's
 * `compileEventRun`) resolve through the exact same rule as {@link characterStageObjectName}, rather
 * than hand-rolling `normalizeStageObjectName(characterId)` and drifting the moment the rule changes.
 */
export function characterStageName(characterId: string | undefined, objectName?: string): string {
    const explicitName = objectName?.trim();
    if (explicitName && explicitName !== "character") {
        return normalizeStageObjectName(explicitName);
    }
    return normalizeStageObjectName(characterId || explicitName || "character");
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
 * **Which operation of each action DECLARES a stage object**, rather than addressing one that
 * already exists. The one table, and the only place the split is written down.
 *
 * It lives here rather than beside the scene-wide helpers in `stageObjects.ts` because the two
 * identity functions - {@link displayableCreatorIdentity} here and `actionableSourceIdentity` in
 * `actionableTarget.ts` - both read it, and both are imported by that module. This file is already
 * where the stage-naming rules those two share live (`normalizeStageObjectName`,
 * {@link characterStageName}), so the table sits with them and the imports stay one-way.
 *
 * The story compiler dispatches on it too: `create` builds through a get-or-create constructor,
 * everything else looks up and reports a miss. That is exactly one rule and it now has exactly one
 * expression, so the compiler's split and lint's cannot drift apart.
 *
 * Anything not listed addresses only - `/transform` and `/fx` never create - and any action with no
 * stage object at all answers false.
 */
export function declaresStageObject(payload: StoryActionPayload): boolean {
    switch (payload.action) {
        // A character portrait comes into existence when the character walks on.
        case "character":
            return payload.operation === "enter";
        case "image":
        case "text":
        case "layer":
        case "video":
        case "vfx":
            return payload.operation === "create";
        // `setBgm` is left out on purpose: it points the reserved music channel at a clip, and that
        // channel is referenced as a built-in rather than bound to the row - see
        // `actionableSourceIdentity`.
        case "audio":
            return payload.operation === "playSound";
        default:
            return false;
    }
}

/**
 * The identity of the displayable a block **declares**, or null when the block only addresses one
 * that already exists. The strict half of {@link displayableSourceIdentity}: same naming rules, but
 * only a row that brings the object into existence answers - `character` enter, `image` create,
 * `text` create, `layer` create.
 *
 * The two cannot be merged, and neither is wrong:
 *  - {@link displayableSourceIdentity} answers "does this row put this name on stage", which is what
 *    the compiler does - `getImage` is get-or-create, so `/show poster` with no create row ahead of
 *    it really does materialise `poster`. The candidate lists, the stage snapshot and the preview
 *    resolver all mirror that, and gating them on `create` would hide objects that genuinely exist.
 *  - This one answers "which row *defines* this object", which is what a stable reference must bind
 *    to. Anchoring a reference to whichever row happened to mention the name first is stable only
 *    while every row spells the name identically; the moment a rename edits the defining row alone,
 *    a reference anchored to a `show` row keeps reporting the old name with nothing to show for it.
 *
 * `layer` reads the same either way - {@link displayableSourceIdentity} already gates it on `create`,
 * because a layer is the one kind the engine will not conjure from a mention.
 */
export function displayableCreatorIdentity(
    block: StoryBlock,
): { kind: StoryDisplayableTargetKind; name: string; label: string } | null {
    if (block.kind !== "action") {
        return null;
    }
    // Delegated twice over: {@link declaresStageObject} states WHICH rows declare, and
    // {@link displayableSourceIdentity} states what the object is called - so the strict reading can
    // never disagree with the permissive one about a name, nor with the compiler about a split.
    return declaresStageObject(block.payload) ? displayableSourceIdentity(block) : null;
}

/**
 * Resolve a displayable target to the stage key + kind that should be used *right now*. When the
 * target carries a stable `sourceBlockId` that still resolves to a creator block, that block's
 * current identity wins, so the reference follows renames. Otherwise the stored `name`/`kind` is
 * returned - for legacy documents authored before stable ids, or a source block that was deleted.
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
    // Legacy / dangling ref: the stored fields are all we have. `label` first, because `name` is the
    // stage key and a key is not always readable - an unnamed character keys on its `characterId`.
    // A reference written before `label` existed has none, and falls back to `name` as it always did.
    return { name: target.name ?? "", kind: target.kind, label: target.label ?? target.name ?? "" };
}

/**
 * The word a row that ADDRESSES a displayable is written with - on its command line, in its one-line
 * description, and as the subject of its script line.
 *
 * The reference is read, never the row's own `objectName`: a rename edits the row that DECLARES the
 * object, and a row showing its own stored copy of the name goes on naming something that no longer
 * answers to it. That is exactly what an author renaming `poster` to `bg` saw - the compiler followed
 * the reference and every surface kept printing `poster`. `objectName` remains the answer for a
 * document written before references existed, which is the fallback here and not a fault.
 *
 * ## Why `label`, and why only when it is also the key
 *
 * `label` is the author-facing half and the only one safe to render: `name` is a lookup key and is
 * not always a word - a character keys on its `characterId`, an unnamed sound on its `assetId`.
 *
 * But a printed subject also has to READ BACK. The command line re-parses what it prints and the
 * script view resolves every subject against the declarations in the same text, and both spell an
 * object by its stage key. So the label is usable exactly when it *is* the key - which is exactly
 * when the declaring row typed a name. When it did not, the key falls back to an id and the label to
 * a placeholder ("Image", "Sound") no reader would accept, and the row keeps the spelling it stored:
 * the last word an author actually saw.
 *
 * A built-in is addressed by its reserved word rather than by its label ("Background music" is two
 * tokens and a subject slot takes one), and that reserved word is what the row already stores - so a
 * built-in target simply keeps the stored spelling too.
 */
export function displayableSubjectWord(
    scene: StoryScene | null | undefined,
    target: StoryDisplayableTargetRef | undefined,
    objectName: string | undefined,
): string {
    const stored = objectName?.trim() ?? "";
    if (!target || target.builtin) {
        return stored;
    }
    const resolved = resolveDisplayableTargetRef(scene, target);
    return resolved.label && resolved.label === resolved.name ? resolved.label : stored || resolved.label;
}
