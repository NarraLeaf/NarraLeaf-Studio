import type { NormalizedCrop } from "@/lib/utils/headCrop";
import type { PsdFingerprint } from "@shared/types/psdImport";
import type { PuppetAppearanceKind } from "@shared/utils/characterAppearanceKinds";
import { isPuppetAppearanceKind } from "@shared/utils/characterAppearanceKinds";

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
    /**
     * The audio bus this character's dialogue voice plays on — a project audio track id.
     *
     * Absent (the ordinary case) means the seeded `voice` bus, which is where every voice line has
     * always played. Setting it to a track *beneath* `voice` is the whole point: the player then has
     * a slider for this character alone, which is how a VN lets someone turn one member of the cast
     * down or off without touching the rest.
     *
     * A plain id rather than a resolved track, and never rewritten when a track is deleted: the id
     * resolves through `resolveAudioTrack`, which falls back to `voice`, so a dangling reference is a
     * character who is merely no longer separately adjustable rather than a character who is silent.
     *
     * On the profile rather than the appearance for the same reason `defaultAvatarAssetId` is: it
     * survives a kind switch, which discards everything the kinds do not share.
     */
    voiceTrackId?: string | null;
}

/**
 * The kind vocabulary lives in `@shared/utils/characterAppearanceKinds` because shared code reads it
 * too (`characterSummaries.ts` maps a stored appearance into the Dev Mode bundle). Re-exported here
 * so this module stays the one place the character model is imported from — every shape below is
 * still owned here.
 */
export type { CharacterAppearanceKind, PuppetAppearanceKind } from "@shared/utils/characterAppearanceKinds";
export {
    CHARACTER_APPEARANCE_KINDS,
    PUPPET_APPEARANCE_KINDS,
    isCharacterAppearanceKind,
    isPuppetAppearanceKind,
} from "@shared/utils/characterAppearanceKinds";

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
    /**
     * How this one differential is framed, overriding the character-wide {@link
     * CharacterEditorProfile.portrait}.
     *
     * It lives on the avatar entry rather than beside the art because that is the only place both
     * image-backed kinds can address a single differential: the table is keyed by avatar key, which
     * is a pose id for `preset` and a sorted tag combination for `layered`. A layered character has
     * no per-combination object to hang a crop on — the combination exists only as a key — so
     * without this a layered author could only ever frame every look at once, which is what
     * dragging the crop box used to do to them silently.
     *
     * `preset` also carries {@link CharacterPose.portrait}, which predates this and is still read
     * (the story rows frame their speaker badge from it). Resolution order is entry → pose →
     * profile; see the baker's `portraitFor`.
     */
    portrait?: PortraitCrop;
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

/**
 * A character drawn by a runtime the *author* supplied, through the engine's puppet seam.
 *
 * The engine owns the box — where it sits, its layer, its transform, its opacity, its entry in a
 * saved game — and hands the inside to a backend registered under {@link backend}. Studio ships no
 * such backend and is not allowed to: the renderers authors want for animated characters are
 * licensed in terms a source-available application cannot meet (card 2026-07-27-002). So this arm
 * carries no renderer-specific field, and never will — every product-specific knob goes in
 * {@link options}, which Studio passes through without reading.
 *
 * Unlike the other two kinds this one has no differentials in Studio's model: what a puppet is
 * doing (motion / expression / skin) is a *runtime* state the backend names, not an authoring-time
 * enumeration, so there is nothing here to key a dialog avatar or a story `/face` row on. The
 * profile-level `defaultAvatarAssetId` is a puppet character's avatar.
 */
export interface PuppetAppearance {
    /**
     * Which runtime this character was created for. One of three names for one shape — see
     * {@link PuppetAppearanceKind}. It is *not* a renderer-specific field in the sense the comment
     * above rules out: it names the runtime the author chose, exactly as `backend` does, and carries
     * no knob any renderer defines.
     */
    kind: PuppetAppearanceKind;
    /**
     * The model asset. Null until the author picks one, and a puppet with no model compiles to
     * nothing — the engine's `src` is required and there is no meaningful empty value for it.
     *
     * A model is a *bundle* (a manifest plus an atlas plus texture pages, or a model file plus its
     * motions and physics), so this names a multi-file asset. Studio resolves it to the bundle's
     * entry-file URL and the engine resolves the rest relative to that, through
     * `PuppetMountContext.resolveSibling` — which is why nothing here enumerates the siblings:
     * which ones exist is only knowable after parsing the entry.
     */
    assetId: string | null;
    /** Backend name, matching a folder under the project's `runtimes/puppet/`. */
    backend: string;
    /**
     * A different entry file within the same bundle; null = the bundle's own declared entry.
     *
     * For bundles that ship several (two skeletons sharing one atlas), or whose declared entry is
     * not the one this character wants. Resolved as a *sibling* of the declared entry — the same
     * arithmetic the engine's `resolveSibling` applies, so a path here means the same thing it
     * would mean inside the model's own manifest, and the two cannot disagree about where the
     * bundle's root is. For the usual bundle, whose entry sits at the top, that is the root.
     */
    entry: string | null;
    /** Stage box size, in logical pixels; null = the stage size. The backend scales its own content inside it. */
    size: { width: number; height: number } | null;
    /** Handed to the backend verbatim. Studio never reads a key of it. */
    options: Record<string, unknown>;
    /** The pose this character rests in. Omitted entirely when the author has set nothing. */
    defaultState?: PuppetDefaultState;
}

/**
 * What a puppet looks like before a story row has said otherwise.
 *
 * These three names are the engine's own vocabulary, not a renderer's - `PuppetState` documents them
 * as "the three ideas every 2D character renderer has", and `IPuppetUserConfig` carries the same
 * three as a puppet's *initial* state. So this is not the renderer-specific knob the surrounding
 * doc comment rules out; it is the same idea as a preset character's default pose, said in the
 * engine's words.
 *
 * `null` on any field is the absence of a request, exactly as the engine defines it - the model
 * rests with no motion applied, no expression applied, and its own default skin. That is why a
 * cleared field has to stay `null` rather than fall back to a model's own "neutral": if the author
 * wants that one they can name it, and then the two still differ.
 */
export interface PuppetDefaultState {
    motion: string | null;
    expression: string | null;
    skin: string | null;
}

export type ICharacterAppearance = PresetAppearance | LayeredAppearance | PuppetAppearance;

/**
 * Narrow an appearance to the puppet arm.
 *
 * Distinct from {@link isPuppetAppearanceKind}, which answers about a kind *string* and therefore
 * cannot narrow the object holding it — a predicate on `appearance.kind` tells TypeScript nothing
 * about `appearance`. Every place that used to discriminate with `kind === "puppet"` needs this one
 * instead, and the three-way `||` it replaces would have to be kept in step with
 * `PUPPET_APPEARANCE_KINDS` by hand.
 */
export function isPuppetAppearance(appearance: ICharacterAppearance | null | undefined): appearance is PuppetAppearance {
    return isPuppetAppearanceKind(appearance?.kind);
}

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
