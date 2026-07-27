import type { NormalizedCrop } from "@/lib/utils/headCrop";
import type { PsdFingerprint } from "@shared/types/psdImport";

/** A portrait framing rect in normalized (0–1) image coordinates — the same shape as {@link NormalizedCrop}. */
export type PortraitCrop = NormalizedCrop;


export interface CharacterBaseProfile {
    name: string;
    readonly id: string;
}

export interface CharacterEditorProfile extends CharacterBaseProfile {
    /**
     * Character Description
     */
    description: string;
    /**
     * Character Tags
     */
    tags: string[];
    /**
     * User defined attributes
     */
    attributes: Record<string, string>;
    /**
     * Editor Asset UUID
     */
    thumbnail: string | null;
    /**
     * Character Nicknames
     */
    nicknames: string[];
    /**
     * Group that the character belongs to
     */
    groupId?: string;
    /**
     * Editor-only accent colour (hex, e.g. `#40a8c4`). Tints the speaker nametag in the story editor
     * (and the dialogue-group header). Optional and additive: older projects load without it and keep
     * the default nametag colour until one is set. Never consumed by the runtime.
     */
    color?: string;
    /**
     * Editor-only default portrait framing (normalized 0–1). Frames the character's story-editor avatar
     * on the face instead of guessing from the alpha silhouette. A pose may override it. Additive: absent
     * on older projects, which then fall back to the automatic head crop. Never consumed by the runtime.
     */
    portrait?: PortraitCrop;
    /**
     * Project image shown as this character's dialog avatar when no differential resolves one —
     * the character is speaking from off-stage, or its current differential has neither a bake nor
     * an override. Lives on the profile rather than on the appearance so it survives a kind switch,
     * which discards everything the two kinds do not share.
     *
     * Unlike {@link thumbnail} (an editor asset, editor-only) this one *is* consumed by the runtime.
     */
    defaultAvatarAssetId?: string | null;
}

/**
 * How a character's sprite is built. Chosen when the character is created; changing it is a cold
 * switch that discards the previous kind's data, because the two carry nothing in common and there
 * is no conversion between them (user ruling 2026-07-26).
 *
 * - `preset` — N finished sprites, one per named pose. N = 1 is the plain single-image character.
 * - `layered` — a stack of layers composited at runtime and switched by tag.
 */
export type CharacterAppearanceKind = "preset" | "layered";

/**
 * Everything an author can rename is an `{ id, name }` pair, and the `id` is what everything else
 * stores — story rows, defaults, layer option maps. Renaming therefore rewrites nothing. The ids
 * double as the engine's tag strings, which the engine requires to be unique and ids are for free.
 */
export interface CharacterNamed {
    readonly id: string;
    name: string;
}

/** One finished sprite of a `preset` character. */
export interface CharacterPose extends CharacterNamed {
    /** Groups the list in the editor. Never consulted when resolving. */
    folder?: string;
    assetId: string | null;
    /** Overrides the profile-level portrait framing for this pose. */
    portrait?: PortraitCrop;
}

/**
 * One axis of variation of a `layered` character (outfit, expression, accessory…) and the tags it
 * can take. An axis drives every layer bound to it, which is the point of the whole model: one
 * "angry" moves the brows and the mouth together.
 */
export interface CharacterAxis extends CharacterNamed {
    tags: CharacterNamed[];
    defaultTagId: string | null;
}

/**
 * One slot of the stack. {@link LayeredAppearance.layers} is ordered bottom to top.
 *
 * A layer with no `axisId` is constant and always draws `assetId`. A layer bound to an axis draws
 * `options[tagId]`, and `options` carries an entry for *every* tag of that axis — `null` where the
 * layer draws nothing. That completeness is not cosmetic: the engine identifies a tag group by its
 * tag set, so a layer offering only part of an axis's tags would declare a second, colliding group.
 * {@link CharacterAppearance} maintains the invariant.
 */
export interface CharacterLayer extends CharacterNamed {
    axisId: string | null;
    assetId?: string | null;
    options?: Record<string, string | null>;
}

/**
 * One differential's dialog avatar.
 *
 * `baked` is the fingerprint of the derived PNG under `resources/characters/avatars/`, which is
 * project content rather than a cache — it travels in the package and belongs in version control,
 * exactly like the project icons. Its presence is what tells the runtime the file is there; its
 * value is what tells the baker the file is current.
 *
 * `overrideAssetId` is the author's own artwork for this differential, and it wins over the bake.
 * A character whose avatar is drawn by hand never bakes anything.
 */
export interface CharacterAvatarEntry {
    baked?: string;
    overrideAssetId?: string | null;
}

/** Avatar entries keyed by {@link CharacterAvatarKey} — pose id (preset) or tag combination (layered). */
export type CharacterAvatarTable = Record<string, CharacterAvatarEntry>;

export interface PresetAppearance {
    kind: "preset";
    poses: CharacterPose[];
    defaultPoseId: string | null;
    /** Dialog avatars keyed by pose id. */
    avatars?: CharacterAvatarTable;
}

export interface LayeredAppearance {
    kind: "layered";
    /**
     * The pixel size every layer asset must match. Under `autoFit` the engine scales each layer so
     * that layer's own width fills the stage, and centres it otherwise, so a layer of a different
     * size is not slightly misplaced — it is stretched to the stage on its own. Null until the first
     * asset sets it.
     */
    canvas: { width: number; height: number } | null;
    axes: CharacterAxis[];
    layers: CharacterLayer[];
    /** Named tag combinations. See {@link CharacterSnapshot}. */
    snapshots?: CharacterSnapshot[];
    /**
     * The PSD this stack was imported from, if any. Studio does not keep the file (user ruling
     * 2026-07-26) — this is the mapping memory that lets a second import of the same PSD refresh the
     * art in place instead of building a second set of axes beside the first.
     */
    psd?: PsdFingerprint;
    /**
     * Which axes the dialog avatar varies with. A layered character has no single image, so its
     * avatars are baked one per combination of these axes — which makes this the knob that decides
     * how many get baked: three axes of four tags is sixty-four avatars, one axis of four is four.
     *
     * Absent means every axis, which is the honest default (the avatar then tracks the whole look)
     * and the one the combination count is reported against.
     */
    avatarAxisIds?: string[];
    /** Dialog avatars keyed by the tag combination (see `characterAvatarKey`). */
    avatars?: CharacterAvatarTable;
}

/**
 * A combination worth coming back to ("angry, arms crossed").
 *
 * Editor convenience only: a story row stores tags, never a snapshot id. Letting rows name a snapshot
 * would put it in the story schema and make renaming and deleting one a referential-integrity problem
 * — the plan leaves that question open, and nothing here forecloses it.
 */
export interface CharacterSnapshot extends CharacterNamed {
    tags: CharacterTagSelection;
}

export type ICharacterAppearance = PresetAppearance | LayeredAppearance;

/** A chosen tag per axis, keyed by axis id. Partial selections are legal and mean "leave the rest". */
export type CharacterTagSelection = Record<string, string>;

/**
 * A layered appearance rendered down to what the engine takes: the stack bottom to top, plus one
 * default tag per group. Layer entries are already asset *urls*, so producing this needs a resolver.
 */
export type ResolvedLayeredDefinition = {
    layers: (string | null | Record<string, string | null>)[];
    defaults: string[];
};

export type CharacterRelationshipType = {
    relationshipName: string;
    relationships: CharacterRelationshipMap[];
};

export type CharacterRelationshipMap = {
    source: string;
    target: string;
    name: string;
};

export interface CharacterGroup {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
}

export type CharacterGroupMap = Record<string, CharacterGroup>;
