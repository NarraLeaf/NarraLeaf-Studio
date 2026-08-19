import type {
    StoryActionPayload,
    StoryActionableBuiltin,
    StoryActionableKind,
    StoryActionableTargetRef,
    StoryBlock,
    StoryScene,
} from "./document";
import { normalizeStageObjectName } from "./displayableTarget";

/**
 * The reserved registry name of the background-music channel. `/vol 0.5` with no target addresses
 * it, and the compiler registers the BGM handle under exactly this key.
 *
 * Lives here because it is a rule of the document, not of any one surface: the scene editor's
 * `BGM_OBJECT_NAME` re-exports it, and the compiler mirrors it as `BGM_SOUND_NAME`.
 */
export const BGM_STAGE_OBJECT_NAME = "bgm";

/** Author-facing label for each built-in actionable singleton. */
export const ACTIONABLE_BUILTIN_META: Record<StoryActionableBuiltin, { name: string; label: string }> = {
    bgm: { name: BGM_STAGE_OBJECT_NAME, label: "Background music" },
};

/**
 * The registry key a `playSound` row registers its handle under.
 *
 * The chain matters and is not `objectName` alone: a row with no name keys on its `assetId`, and a
 * row with neither on the literal `sound`. This mirrors the compiler exactly, for the same reason
 * `characterStageObjectName` does - the two must not drift, or a reference resolves to a key nothing
 * on stage answers to.
 *
 * The result can therefore be an asset UUID. That makes it a lookup key and never a label; render
 * the `label` a resolver hands back instead.
 */
export function soundStageObjectName(payload: Extract<StoryActionPayload, { action: "audio" }>): string {
    return normalizeStageObjectName(payload.objectName || payload.assetId || "sound");
}

/**
 * The identity of the `Actionable` a block declares, or null when the block only addresses one that
 * already exists. The `Actionable` counterpart of `displayableCreatorIdentity`, and strict for the
 * same reason: a reference binds to the row that *defines* the handle, never to the first row that
 * happens to name it.
 *
 * `setBgm` is deliberately not a declaration. The handle it registers is the reserved music channel,
 * which a scene can also declare on its own record and which every `/vol` addresses by the reserved
 * word whether or not this scene holds a `/bgm` row - so it is referenced as
 * `{ builtin: "bgm" }` rather than bound to a block. Binding it would give one channel two identities.
 */
export function actionableSourceIdentity(
    block: StoryBlock,
): { kind: StoryActionableKind; name: string; label: string } | null {
    if (block.kind !== "action") {
        return null;
    }
    const payload = block.payload;
    if (payload.action === "video") {
        return payload.operation === "create"
            ? { kind: "video", name: normalizeStageObjectName(payload.objectName), label: payload.objectName?.trim() || "Video" }
            : null;
    }
    if (payload.action === "vfx") {
        return payload.operation === "create"
            ? { kind: "vfx", name: normalizeStageObjectName(payload.objectName), label: payload.objectName?.trim() || "Vfx" }
            : null;
    }
    if (payload.action === "audio") {
        return payload.operation === "playSound"
            ? { kind: "audio", name: soundStageObjectName(payload), label: payload.objectName?.trim() || "Sound" }
            : null;
    }
    return null;
}

export type ResolvedStoryActionableTarget = {
    /** The registry key to look the handle up by - what the compiler registered it under. */
    name: string;
    /** The author-facing name, and the only one safe to render: `name` can be an asset UUID. */
    label: string;
    /** False for a legacy or dangling reference, where `name` is only the last one the author saw. */
    resolved: boolean;
};

/**
 * Resolve an actionable reference to the registry key + label that hold *right now*, mirroring
 * `resolveDisplayableTargetRef`: a `builtin` wins outright, then a `sourceBlockId` that still
 * resolves to a declaring block of the expected kind, and only failing both does the stored `name`
 * stand - a document authored before stable ids, or a declaring row since deleted.
 *
 * `kind` is passed rather than read off the reference because the reference does not carry one: the
 * row's own `action` states it. It is checked, not assumed - a reference left behind by an edit that
 * turned a `/video` row into a `/vfx` row must fall back to its stored name rather than silently
 * resolve through a block of the wrong kind.
 */
export function resolveActionableTargetRef(
    scene: StoryScene | null | undefined,
    ref: StoryActionableTargetRef,
    kind: StoryActionableKind,
): ResolvedStoryActionableTarget {
    if (ref.builtin) {
        const meta = ACTIONABLE_BUILTIN_META[ref.builtin];
        return { name: meta.name, label: meta.label, resolved: true };
    }
    if (ref.sourceBlockId) {
        const source = scene?.blocks[ref.sourceBlockId];
        const identity = source ? actionableSourceIdentity(source) : null;
        if (identity && identity.kind === kind) {
            return { name: identity.name, label: identity.label, resolved: true };
        }
    }
    // Legacy / dangling ref: `label` first, because `name` is the registry key and an unnamed sound
    // keys on its `assetId` - falling back to it would put a UUID on screen. A reference written
    // before `label` existed has none, and falls back to `name` exactly as it did before.
    const name = ref.name ?? "";
    return { name, label: ref.label ?? name, resolved: false };
}
