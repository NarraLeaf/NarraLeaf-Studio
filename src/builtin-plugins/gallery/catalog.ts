/**
 * Gallery catalog: the shape of the authored data and the pure helpers that
 * read it. Shared by all three entries - the studio panel (main.tsx) owns
 * editing, and the node definitions (nodes.ts) read it in both the editor and
 * the game runtime.
 *
 * Nothing here may import Studio internals: plugin bundles only resolve
 * `narraleaf-studio/plugin` and `narraleaf-studio/runtime`, so wire formats such
 * as the ImageAsset envelope are constructed literally.
 *
 * The projections at the bottom (`projectGalleryEntries`, `projectGalleryVariants`)
 * are the load-bearing part of the whole plugin: they turn the authored catalog
 * plus the player's unlock record into flat, JSON-safe rows that drop straight
 * into a List widget. Keeping them here - pure, and shared by studio, runtime and
 * tests - is what stops the editor preview and the shipped game from disagreeing
 * about what a locked CG looks like.
 */

export const PLUGIN_ID = "narraleaf.gallery";

/** Plugin storage namespace holding the catalog; published via contributes.runtimeData. */
export const GALLERY_STORE_NAMESPACE = `${PLUGIN_ID}.items`;

/** Application-level persistence key holding unlocked variant ids. */
export const RUNTIME_UNLOCKED_KEY = `${PLUGIN_ID}.unlocked`;

/**
 * What a catalog entry represents.
 *
 * The four EXTRA columns of a commercial visual novel share one skeleton - an
 * unlockable set with groups, spoiler masking and progress - so they are kinds
 * in one catalog rather than four parallel systems. Concretely, an album is an
 * entry whose variants are its tracks, which is the same shape as an artwork
 * whose variants are its differentials; the unlock record, group filter,
 * masking and stats therefore work on all of them unchanged.
 *
 * Readers must treat an unknown kind as "not mine" and skip it, so a project
 * authored in a newer Studio degrades instead of breaking.
 */
export type GalleryEntryKind = "cg" | "scene" | "music" | "voice";

export const GALLERY_ENTRY_KINDS: readonly GalleryEntryKind[] = ["cg", "scene", "music", "voice"];

/** True for kinds whose variants carry an audio asset rather than only art. */
export function isAudioGalleryKind(kind: GalleryEntryKind): boolean {
    return kind === "music" || kind === "voice";
}

/**
 * One member of an entry: a differential of an artwork, a track of an album, or
 * a line of a voice set. Which fields matter depends on the parent's kind; the
 * unused ones stay absent rather than null so a CG never carries empty audio
 * keys around.
 */
export type GalleryVariant = {
    id: string;
    name: string;
    imageAssetId: string | null;
    imageAssetName?: string | null;
    /**
     * Optional smaller image for grid cells. Absent means the grid uses the
     * full image, which is the right default - a separate thumbnail is an
     * optimization for projects whose CGs are large, not a requirement.
     */
    thumbnailAssetId?: string | null;
    thumbnailAssetName?: string | null;
    /** `music`: the track. `voice`: set when a line is backed by a loose clip. */
    audioAssetId?: string | null;
    audioAssetName?: string | null;
    /** Known clip length, for a track list that shows durations without decoding. */
    durationSec?: number | null;
    /**
     * `voice`: the voice unit id, which is the story line's `textId` - the same
     * key the translation table and the engine's voiceId use. The clip itself is
     * resolved from the shipped voice table at runtime, so a voice entry does
     * not duplicate the asset id.
     */
    voiceUnitId?: string | null;
    /** `voice`: the line text as it read when picked, for a subtitle in the viewer. */
    lineText?: string | null;
};

/**
 * Where a `scene` entry replays from. `startBlockId` narrows the replay to a
 * specific row, which the host's launch compile already supports; absent means
 * the scene start.
 */
export type GalleryScenePayload = {
    storyId: string | null;
    sceneId: string | null;
    startBlockId?: string | null;
};

/** One gallery entry, holding an ordered list of members. */
export type GalleryArtwork = {
    id: string;
    name: string;
    kind: GalleryEntryKind;
    /** Author-facing blurb shown in a viewer. Withheld while locked. */
    description: string;
    /** Group this entry belongs to, or null for ungrouped. */
    groupId: string | null;
    variants: GalleryVariant[];
    /** Variant shown as the entry's cover. Falls back to the first variant. */
    coverVariantId: string | null;
    /**
     * Silhouette drawn in place of the cover while the entry is locked.
     * Falls back to the catalog-wide placeholder in settings.
     */
    lockedImageAssetId: string | null;
    lockedImageAssetName?: string | null;
    /**
     * Secret entry: omitted from the entries projection entirely until it is
     * unlocked, rather than shown as an empty slot. The distinction matters -
     * a visible locked slot tells the player there is something to find, and
     * for some content that is itself the spoiler.
     */
    hidden: boolean;
    /** `scene` only: what to replay. */
    scene?: GalleryScenePayload | null;
    createdAt: number;
    updatedAt: number;
};

export type GalleryGroup = {
    id: string;
    name: string;
};

/** Catalog-wide presentation defaults. */
export type GallerySettings = {
    /** Fallback silhouette for locked artworks without their own. */
    lockedImageAssetId: string | null;
    lockedImageAssetName?: string | null;
    /**
     * Title shown for a locked artwork instead of its real name. Empty string
     * means "show the real name", which some galleries want.
     */
    lockedNameMask: string;
};

export const DEFAULT_LOCKED_NAME_MASK = "???";

/**
 * v4 adds the non-CG kinds and their fields. Reading a v3 store needs no
 * migration step: every v3 entry already carries `kind: "cg"`, and the new
 * variant fields are optional, so the v3 normalizer's output is already valid v4.
 */
export const GALLERY_STORE_VERSION = 4 as const;

export type GalleryStoreData = {
    version: typeof GALLERY_STORE_VERSION;
    groups: GalleryGroup[];
    items: GalleryArtwork[];
    settings: GallerySettings;
};

/**
 * The blueprint ImageAsset wire format. Duplicated from the host's
 * `BlueprintImageAsset` because plugins cannot import Studio types; the host
 * normalizes anything shaped like this (and bare asset id strings) on the way in.
 */
export type GalleryImageAssetValue = {
    kind: "imageAsset";
    assetId: string;
};

export function toImageAssetValue(assetId: string | null | undefined): GalleryImageAssetValue | null {
    const safe = typeof assetId === "string" ? assetId.trim() : "";
    return safe ? { kind: "imageAsset", assetId: safe } : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function readTrimmedString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function readNullableAssetId(value: unknown): string | null {
    return readTrimmedString(value) || null;
}

function readTimestamp(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Variant ids are derived from their artwork id, which keeps them globally
 * unique and - crucially - makes it impossible for a variant id to collide with
 * an artwork id. The unlock-set migration below relies on that distinction.
 */
export function createVariantId(artworkId: string): string {
    return `${artworkId}.v.${randomToken()}`;
}

export function createArtworkId(): string {
    return `${PLUGIN_ID}.${randomToken()}`;
}

export function createGroupId(): string {
    return `${PLUGIN_ID}.g.${randomToken()}`;
}

function randomToken(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readPositiveNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeVariant(raw: unknown, index: number): GalleryVariant | null {
    const record = readRecord(raw);
    if (!record) {
        return null;
    }
    const id = readTrimmedString(record.id);
    if (!id) {
        return null;
    }
    const thumbnailAssetId = readNullableAssetId(record.thumbnailAssetId);
    const audioAssetId = readNullableAssetId(record.audioAssetId);
    const durationSec = readPositiveNumber(record.durationSec);
    const voiceUnitId = readNullableAssetId(record.voiceUnitId);
    const lineText = typeof record.lineText === "string" && record.lineText ? record.lineText : null;
    // Kind-specific fields are omitted rather than nulled, so a CG variant does
    // not carry four empty audio keys through every projection and save.
    return {
        id,
        name: readTrimmedString(record.name) || `Item ${index + 1}`,
        imageAssetId: readNullableAssetId(record.imageAssetId),
        imageAssetName: readNullableAssetId(record.imageAssetName),
        ...(thumbnailAssetId ? {
            thumbnailAssetId,
            thumbnailAssetName: readNullableAssetId(record.thumbnailAssetName),
        } : {}),
        ...(audioAssetId ? {
            audioAssetId,
            audioAssetName: readNullableAssetId(record.audioAssetName),
        } : {}),
        ...(durationSec !== null ? { durationSec } : {}),
        ...(voiceUnitId ? { voiceUnitId } : {}),
        ...(lineText ? { lineText } : {}),
    };
}

function normalizeScenePayload(value: unknown): GalleryScenePayload | null {
    const record = readRecord(value);
    if (!record) {
        return null;
    }
    const storyId = readTrimmedString(record.storyId) || null;
    const sceneId = readTrimmedString(record.sceneId) || null;
    const startBlockId = readTrimmedString(record.startBlockId) || null;
    if (!storyId && !sceneId) {
        return null;
    }
    return { storyId, sceneId, ...(startBlockId ? { startBlockId } : {}) };
}

/**
 * Migrate a v1 entry (one artwork == one image) into the current shape.
 *
 * The synthesized variant id must be deterministic: a random id would drift on
 * every load, orphaning both the unlock records players already hold and the
 * variant ids authored into blueprint node params.
 */
function migrateLegacyArtwork(record: Record<string, unknown>, id: string, now: number): GalleryArtwork {
    const variantId = `${id}.v1`;
    const name = readTrimmedString(record.name) || id;
    return {
        id,
        name,
        kind: "cg",
        description: "",
        groupId: null,
        variants: [{
            id: variantId,
            name,
            imageAssetId: readNullableAssetId(record.imageAssetId),
            imageAssetName: readNullableAssetId(record.imageAssetName),
        }],
        coverVariantId: variantId,
        lockedImageAssetId: null,
        hidden: false,
        createdAt: readTimestamp(record.createdAt, now),
        updatedAt: readTimestamp(record.updatedAt, now),
    };
}

function normalizeArtwork(raw: unknown, now: number): GalleryArtwork | null {
    const record = readRecord(raw);
    if (!record) {
        return null;
    }
    const id = readTrimmedString(record.id);
    if (!id) {
        return null;
    }
    // Detect per item rather than trusting the store's version field, so a
    // partially migrated store still loads correctly.
    if (!Array.isArray(record.variants)) {
        return migrateLegacyArtwork(record, id, now);
    }
    const variants = record.variants
        .map((rawVariant, index) => normalizeVariant(rawVariant, index))
        .filter((variant): variant is GalleryVariant => variant !== null);
    const coverVariantId = readTrimmedString(record.coverVariantId);
    const kind = readTrimmedString(record.kind);
    // v2 predates `kind`; everything authored then was an artwork. An unknown
    // kind (a project from a newer Studio) also reads as "cg" rather than being
    // dropped, so the author still sees their entry and can retype it.
    const safeKind = GALLERY_ENTRY_KINDS.includes(kind as GalleryEntryKind)
        ? kind as GalleryEntryKind
        : "cg";
    const scene = safeKind === "scene" ? normalizeScenePayload(record.scene) : null;
    return {
        id,
        name: readTrimmedString(record.name) || id,
        kind: safeKind,
        description: typeof record.description === "string" ? record.description : "",
        groupId: readTrimmedString(record.groupId) || null,
        variants,
        coverVariantId: variants.some(variant => variant.id === coverVariantId)
            ? coverVariantId
            : null,
        lockedImageAssetId: readNullableAssetId(record.lockedImageAssetId),
        lockedImageAssetName: readNullableAssetId(record.lockedImageAssetName),
        hidden: record.hidden === true,
        ...(scene ? { scene } : {}),
        createdAt: readTimestamp(record.createdAt, now),
        updatedAt: readTimestamp(record.updatedAt, now),
    };
}

function normalizeGroups(value: unknown): GalleryGroup[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const groups: GalleryGroup[] = [];
    const seen = new Set<string>();
    for (const raw of value) {
        const record = readRecord(raw);
        if (!record) {
            continue;
        }
        const id = readTrimmedString(record.id);
        if (!id || seen.has(id)) {
            continue;
        }
        seen.add(id);
        groups.push({ id, name: readTrimmedString(record.name) || id });
    }
    return groups;
}

function normalizeSettings(value: unknown): GallerySettings {
    const record = readRecord(value);
    if (!record) {
        return {
            lockedImageAssetId: null,
            lockedImageAssetName: null,
            lockedNameMask: DEFAULT_LOCKED_NAME_MASK,
        };
    }
    return {
        lockedImageAssetId: readNullableAssetId(record.lockedImageAssetId),
        lockedImageAssetName: readNullableAssetId(record.lockedImageAssetName),
        // An explicitly empty mask means "show real names"; only a missing
        // field falls back to the default.
        lockedNameMask: typeof record.lockedNameMask === "string"
            ? record.lockedNameMask
            : DEFAULT_LOCKED_NAME_MASK,
    };
}

/**
 * Coerce untrusted stored data into a well-formed store. Accepts the v1, v2 and
 * v3 layouts, and both the wrapped store object and a bare item array. Never
 * throws: a corrupt catalog degrades to fewer entries rather than breaking the
 * panel or a running game.
 */
export function normalizeGalleryStore(value: unknown): GalleryStoreData {
    const wrapper = readRecord(value);
    const rawItems = Array.isArray(value)
        ? value
        : Array.isArray(wrapper?.items)
            ? wrapper.items
            : [];

    const now = Date.now();
    const items: GalleryArtwork[] = [];
    for (const raw of rawItems) {
        const artwork = normalizeArtwork(raw, now);
        if (artwork) {
            items.push(artwork);
        }
    }

    const groups = normalizeGroups(wrapper?.groups);
    // A group deleted out from under its artworks must not strand them in a
    // group the UI no longer shows; they fall back to ungrouped.
    const groupIds = new Set(groups.map(group => group.id));
    for (const artwork of items) {
        if (artwork.groupId && !groupIds.has(artwork.groupId)) {
            artwork.groupId = null;
        }
    }

    return {
        version: GALLERY_STORE_VERSION,
        groups,
        items,
        settings: normalizeSettings(wrapper?.settings),
    };
}

/** Items-only view of {@link normalizeGalleryStore}, for readers that need no chrome. */
export function normalizeGalleryCatalog(value: unknown): GalleryArtwork[] {
    return normalizeGalleryStore(value).items;
}

export function findArtwork(artworks: GalleryArtwork[], artworkId: string): GalleryArtwork | null {
    const id = artworkId.trim();
    return id ? artworks.find(artwork => artwork.id === id) ?? null : null;
}

/** The artwork's cover variant: the explicit choice, else the first variant. */
export function resolveCoverVariant(artwork: GalleryArtwork): GalleryVariant | null {
    if (artwork.coverVariantId) {
        const explicit = artwork.variants.find(variant => variant.id === artwork.coverVariantId);
        if (explicit) {
            return explicit;
        }
    }
    return artwork.variants[0] ?? null;
}

/**
 * Read the persisted unlock record as a set of variant ids.
 *
 * v1 stored artwork ids, because unlocking was per-artwork. Those entries are
 * expanded to every variant of the artwork on read, so a player who unlocked a
 * CG before the split keeps seeing it. The catalog is needed for that expansion,
 * which is why unlock reads are always catalog-aware.
 */
export function readUnlockedVariantIds(value: unknown, artworks: GalleryArtwork[]): Set<string> {
    const stored = Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string")
        : [];
    const artworkById = new Map(artworks.map(artwork => [artwork.id, artwork] as const));
    const unlocked = new Set<string>();
    for (const id of stored) {
        const artwork = artworkById.get(id);
        if (artwork) {
            for (const variant of artwork.variants) {
                unlocked.add(variant.id);
            }
            continue;
        }
        unlocked.add(id);
    }
    return unlocked;
}

/** True when any variant of the artwork is unlocked. */
export function isArtworkUnlocked(artwork: GalleryArtwork, unlocked: Set<string>): boolean {
    return artwork.variants.some(variant => unlocked.has(variant.id));
}

export function countUnlockedVariants(artwork: GalleryArtwork, unlocked: Set<string>): number {
    return artwork.variants.reduce((total, variant) => total + (unlocked.has(variant.id) ? 1 : 0), 0);
}

/**
 * A gallery grid row. Flat and JSON-safe on purpose: this is fed straight into
 * a List widget through Set List Content, and every field is then readable from
 * the item template with Get List Item Props + Get JSON Field. Anything a cell
 * needs to draw itself must be a field here, because the item template has no
 * other route back to the catalog.
 */
export type GalleryEntryView = {
    index: number;
    id: string;
    /** Masked while locked when the catalog defines a mask. */
    name: string;
    /** Withheld while locked - a description is as much a spoiler as the art. */
    description: string;
    kind: GalleryEntryKind;
    groupId: string;
    groupName: string;
    unlocked: boolean;
    /** Convenience inverse, so an item template can bind visibility without a Not node. */
    locked: boolean;
    variantCount: number;
    unlockedCount: number;
    /** Cover art while unlocked, the locked placeholder otherwise; null when neither exists. */
    image: GalleryImageAssetValue | null;
    /** Same asset as `image` in bare-string form, for writes to `imageFill.assetId`. */
    assetId: string;
    thumbnail: GalleryImageAssetValue | null;
    thumbnailAssetId: string;
    coverVariantId: string;
    /**
     * `music` / `voice`: the cover member's clip, ready for Play Sound. Empty
     * while locked, like the art.
     */
    audioAssetId: string;
    durationSec: number;
    /** `voice`: the cover member's unit id, for Resolve Voice Asset. */
    voiceUnitId: string;
    /** `scene`: where Start Game should replay from. Empty while locked. */
    storyId: string;
    sceneId: string;
    startBlockId: string;
};

/** One member of an entry: a differential, a track, or a voice line. */
export type GalleryVariantView = {
    index: number;
    id: string;
    artworkId: string;
    name: string;
    unlocked: boolean;
    locked: boolean;
    image: GalleryImageAssetValue | null;
    assetId: string;
    thumbnail: GalleryImageAssetValue | null;
    thumbnailAssetId: string;
    isCover: boolean;
    /** `music` / `voice`: the clip. Empty while locked. */
    audioAssetId: string;
    durationSec: number;
    /** `voice`: unit id and the line text for a subtitle. Empty while locked. */
    voiceUnitId: string;
    lineText: string;
};

export type GalleryProjectionOptions = {
    /** Restrict to one group id. Empty or absent means every group. */
    groupId?: string | null;
    /** Restrict to one kind. Empty or absent means every kind. */
    kind?: GalleryEntryKind | null;
    /** Drop locked entries entirely, for a "collected only" view. */
    onlyUnlocked?: boolean;
};

function lockedPlaceholderAssetId(artwork: GalleryArtwork, settings: GallerySettings): string | null {
    return artwork.lockedImageAssetId ?? settings.lockedImageAssetId;
}

/**
 * Project the catalog into gallery rows.
 *
 * Lock state is resolved *here* rather than left to the author's graph, so a
 * locked CG cannot leak through a template that forgot to check: a locked row
 * carries the placeholder art, the masked title and no description. Hidden
 * artworks are dropped outright until unlocked.
 */
export function projectGalleryEntries(
    store: GalleryStoreData,
    unlocked: Set<string>,
    options: GalleryProjectionOptions = {},
): GalleryEntryView[] {
    const groupNames = new Map(store.groups.map(group => [group.id, group.name] as const));
    const groupFilter = options.groupId?.trim() || "";
    const kindFilter = options.kind ?? null;
    const views: GalleryEntryView[] = [];

    for (const artwork of store.items) {
        if (groupFilter && (artwork.groupId ?? "") !== groupFilter) {
            continue;
        }
        if (kindFilter && artwork.kind !== kindFilter) {
            continue;
        }
        const isUnlocked = isArtworkUnlocked(artwork, unlocked);
        if (!isUnlocked && (artwork.hidden || options.onlyUnlocked)) {
            continue;
        }
        const cover = resolveCoverVariant(artwork);
        const assetId = isUnlocked
            ? cover?.imageAssetId ?? null
            : lockedPlaceholderAssetId(artwork, store.settings);
        // A locked cell shows the placeholder in both slots: a thumbnail of the
        // real art would defeat the placeholder.
        const thumbnailAssetId = isUnlocked
            ? cover?.thumbnailAssetId ?? cover?.imageAssetId ?? null
            : assetId;

        views.push({
            // Index is assigned after filtering so it always matches the row's
            // position in the array the List widget receives.
            index: views.length,
            id: artwork.id,
            name: isUnlocked || !store.settings.lockedNameMask
                ? artwork.name
                : store.settings.lockedNameMask,
            description: isUnlocked ? artwork.description : "",
            kind: artwork.kind,
            groupId: artwork.groupId ?? "",
            groupName: artwork.groupId ? groupNames.get(artwork.groupId) ?? "" : "",
            unlocked: isUnlocked,
            locked: !isUnlocked,
            variantCount: artwork.variants.length,
            unlockedCount: countUnlockedVariants(artwork, unlocked),
            image: toImageAssetValue(assetId),
            assetId: assetId ?? "",
            thumbnail: toImageAssetValue(thumbnailAssetId),
            thumbnailAssetId: thumbnailAssetId ?? "",
            coverVariantId: cover?.id ?? "",
            // Audio, voice and scene coordinates follow the same discipline as
            // the art: withheld while locked. A scene id is a spoiler too - it
            // names the chapter the player has not reached.
            audioAssetId: isUnlocked ? cover?.audioAssetId ?? "" : "",
            durationSec: isUnlocked ? cover?.durationSec ?? 0 : 0,
            voiceUnitId: isUnlocked ? cover?.voiceUnitId ?? "" : "",
            storyId: isUnlocked ? artwork.scene?.storyId ?? "" : "",
            sceneId: isUnlocked ? artwork.scene?.sceneId ?? "" : "",
            startBlockId: isUnlocked ? artwork.scene?.startBlockId ?? "" : "",
        });
    }
    return views;
}

/** Project one artwork's differentials, with the same lock discipline. */
export function projectGalleryVariants(
    store: GalleryStoreData,
    artwork: GalleryArtwork,
    unlocked: Set<string>,
    options: Pick<GalleryProjectionOptions, "onlyUnlocked"> = {},
): GalleryVariantView[] {
    const coverId = resolveCoverVariant(artwork)?.id ?? null;
    const placeholder = lockedPlaceholderAssetId(artwork, store.settings);
    const views: GalleryVariantView[] = [];

    for (const variant of artwork.variants) {
        const isUnlocked = unlocked.has(variant.id);
        if (!isUnlocked && options.onlyUnlocked) {
            continue;
        }
        const assetId = isUnlocked ? variant.imageAssetId : placeholder;
        const thumbnailAssetId = isUnlocked
            ? variant.thumbnailAssetId ?? variant.imageAssetId ?? null
            : assetId;
        views.push({
            index: views.length,
            id: variant.id,
            artworkId: artwork.id,
            name: isUnlocked || !store.settings.lockedNameMask
                ? variant.name
                : store.settings.lockedNameMask,
            unlocked: isUnlocked,
            locked: !isUnlocked,
            image: toImageAssetValue(assetId),
            assetId: assetId ?? "",
            thumbnail: toImageAssetValue(thumbnailAssetId),
            thumbnailAssetId: thumbnailAssetId ?? "",
            isCover: variant.id === coverId,
            audioAssetId: isUnlocked ? variant.audioAssetId ?? "" : "",
            durationSec: isUnlocked ? variant.durationSec ?? 0 : 0,
            voiceUnitId: isUnlocked ? variant.voiceUnitId ?? "" : "",
            lineText: isUnlocked ? variant.lineText ?? "" : "",
        });
    }
    return views;
}

export type GalleryStats = {
    /** Artworks the player can see: every non-hidden one, plus unlocked secrets. */
    total: number;
    unlocked: number;
    variantTotal: number;
    variantUnlocked: number;
    /** Artwork completion as a 0-100 integer, for a progress meter. */
    percent: number;
};

/**
 * Completion figures for a gallery header.
 *
 * Hidden artworks are excluded from the denominator until found, so a secret CG
 * cannot betray its own existence by making the counter read 12/13.
 */
export function computeGalleryStats(
    store: GalleryStoreData,
    unlocked: Set<string>,
    options: Pick<GalleryProjectionOptions, "groupId" | "kind"> = {},
): GalleryStats {
    const groupFilter = options.groupId?.trim() || "";
    const kindFilter = options.kind ?? null;
    let total = 0;
    let unlockedCount = 0;
    let variantTotal = 0;
    let variantUnlocked = 0;

    for (const artwork of store.items) {
        if (groupFilter && (artwork.groupId ?? "") !== groupFilter) {
            continue;
        }
        if (kindFilter && artwork.kind !== kindFilter) {
            continue;
        }
        const isUnlocked = isArtworkUnlocked(artwork, unlocked);
        if (!isUnlocked && artwork.hidden) {
            continue;
        }
        total += 1;
        unlockedCount += isUnlocked ? 1 : 0;
        variantTotal += artwork.variants.length;
        variantUnlocked += countUnlockedVariants(artwork, unlocked);
    }

    return {
        total,
        unlocked: unlockedCount,
        variantTotal,
        variantUnlocked,
        percent: total === 0 ? 0 : Math.round((unlockedCount / total) * 100),
    };
}
