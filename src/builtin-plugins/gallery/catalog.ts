/**
 * Gallery catalog: the shape of the authored data and the pure helpers that
 * read it. Shared by all three entries - the studio panel (main.tsx) owns
 * editing, and the node definitions (nodes.ts) read it in both the editor and
 * the game runtime.
 *
 * Nothing here may import Studio internals: plugin bundles only resolve
 * `narraleaf-studio/plugin` and `narraleaf-studio/runtime`, so wire formats such
 * as the ImageAsset envelope are constructed literally.
 */

export const PLUGIN_ID = "narraleaf.gallery";

/** Plugin storage namespace holding the catalog; published via contributes.runtimeData. */
export const GALLERY_STORE_NAMESPACE = `${PLUGIN_ID}.items`;

/** Application-level persistence key holding unlocked variant ids. */
export const RUNTIME_UNLOCKED_KEY = `${PLUGIN_ID}.unlocked`;

/** A single differential of an artwork (expression / outfit / stage variation). */
export type GalleryVariant = {
    id: string;
    name: string;
    imageAssetId: string | null;
    imageAssetName?: string | null;
};

/** One gallery artwork, holding an ordered list of differentials. */
export type GalleryArtwork = {
    id: string;
    name: string;
    variants: GalleryVariant[];
    /** Variant shown as the artwork's cover. Falls back to the first variant. */
    coverVariantId: string | null;
    createdAt: number;
    updatedAt: number;
};

export const GALLERY_STORE_VERSION = 2 as const;

export type GalleryStoreData = {
    version: typeof GALLERY_STORE_VERSION;
    items: GalleryArtwork[];
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

function randomToken(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeVariant(raw: unknown, artworkId: string, index: number): GalleryVariant | null {
    const record = readRecord(raw);
    if (!record) {
        return null;
    }
    const id = readTrimmedString(record.id);
    if (!id) {
        return null;
    }
    return {
        id,
        name: readTrimmedString(record.name) || `Variant ${index + 1}`,
        imageAssetId: readNullableAssetId(record.imageAssetId),
        imageAssetName: readNullableAssetId(record.imageAssetName),
    };
}

/**
 * Migrate a v1 entry (one artwork == one image) into the v2 shape.
 *
 * The synthesized variant id must be deterministic: a random id would drift on
 * every load, orphaning both the unlock records players already hold and the
 * variant ids authored into blueprint node params.
 */
function migrateLegacyArtwork(record: Record<string, unknown>, id: string, now: number): GalleryArtwork {
    const variantId = `${id}.v1`;
    const imageAssetId = readNullableAssetId(record.imageAssetId);
    const imageAssetName = readNullableAssetId(record.imageAssetName);
    const name = readTrimmedString(record.name) || id;
    return {
        id,
        name,
        variants: [{
            id: variantId,
            name,
            imageAssetId,
            imageAssetName,
        }],
        coverVariantId: variantId,
        createdAt: typeof record.createdAt === "number" ? record.createdAt : now,
        updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : now,
    };
}

/**
 * Coerce untrusted stored data into a well-formed catalog. Accepts both the v1
 * and v2 layouts, and both the wrapped store object and a bare item array.
 * Never throws: a corrupt catalog degrades to fewer entries rather than
 * breaking the panel or a running game.
 */
export function normalizeGalleryCatalog(value: unknown): GalleryArtwork[] {
    const wrapper = readRecord(value);
    const rawItems = Array.isArray(value)
        ? value
        : Array.isArray(wrapper?.items)
            ? wrapper.items
            : [];

    const now = Date.now();
    const artworks: GalleryArtwork[] = [];
    for (const raw of rawItems) {
        const record = readRecord(raw);
        if (!record) {
            continue;
        }
        const id = readTrimmedString(record.id);
        if (!id) {
            continue;
        }
        // Detect per item rather than trusting the store's version field, so a
        // partially migrated store still loads correctly.
        if (!Array.isArray(record.variants)) {
            artworks.push(migrateLegacyArtwork(record, id, now));
            continue;
        }
        const variants = record.variants
            .map((rawVariant, index) => normalizeVariant(rawVariant, id, index))
            .filter((variant): variant is GalleryVariant => variant !== null);
        const coverVariantId = readTrimmedString(record.coverVariantId);
        artworks.push({
            id,
            name: readTrimmedString(record.name) || id,
            variants,
            coverVariantId: variants.some(variant => variant.id === coverVariantId)
                ? coverVariantId
                : null,
            createdAt: typeof record.createdAt === "number" ? record.createdAt : now,
            updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : now,
        });
    }
    return artworks;
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
