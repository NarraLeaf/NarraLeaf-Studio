/**
 * Gallery blueprint node definitions, shared by both plugin entries:
 * - main.tsx (studio entry) registers the full defs for the editor palette
 *   and in-editor preview execution.
 * - runtime.ts (runtime entry) registers the execute bindings for game
 *   execution environments (Dev Mode window, Preview, Production).
 *
 * The execute functions live here once so both targets ship the same logic.
 * Each target supplies its own catalog reader: the studio entry reads the live
 * panel store, the runtime entry reads the copy published with the game.
 *
 * Note every value-producing node is `isPure: false` with exec pins. Pure nodes
 * are resolved by the host's own data resolver, which only knows built-in node
 * types - a pure plugin node's execute would never run and its outputs would
 * always be empty.
 */

import type { BlueprintNodeDef } from "narraleaf-studio/plugin";
import {
    findArtwork,
    isArtworkUnlocked,
    normalizeGalleryCatalog,
    readUnlockedVariantIds,
    resolveCoverVariant,
    toImageAssetValue,
    type GalleryArtwork,
    type GalleryVariant,
    PLUGIN_ID,
    RUNTIME_UNLOCKED_KEY,
} from "./catalog";

export { PLUGIN_ID, RUNTIME_UNLOCKED_KEY, GALLERY_STORE_NAMESPACE } from "./catalog";

/** Dynamic select option source ids, provided by the studio entry. */
export const DYNAMIC_OPTIONS_SOURCE = `${PLUGIN_ID}.items`;
export const VARIANT_OPTIONS_SOURCE = `${PLUGIN_ID}.variants`;

/**
 * Host value type tags. Written literally because plugins cannot import the
 * host's valueTypes module. `ImageAsset|null` is the nullable form: a locked or
 * imageless variant yields null, and every built-in image consumer accepts it.
 */
const VALUE_TYPE_IMAGE_ASSET_NULLABLE = "ImageAsset|null";

const PARAM_ARTWORK = "galleryItemId";
const PARAM_VARIANT = "galleryVariantId";
const PIN_ARTWORK_ID = "artworkId";
const PIN_INDEX = "index";

type ExecuteCtx = Parameters<BlueprintNodeDef["execute"]>[0];

/** Reads the authored catalog. Target-specific; see the module comment. */
export type GalleryCatalogReader = () => unknown;

const execIn = { id: "in", kind: "input", semantic: "exec", label: "In" } as const;
const execNext = { id: "next", kind: "output", semantic: "exec", label: "Next" } as const;

/**
 * Optional override for the artwork chosen in the inspector. Without it an
 * artwork can only be picked at author time, which makes iteration impossible -
 * a gallery grid needs to feed one node's artwork id into the next node.
 */
const artworkIdIn = {
    id: PIN_ARTWORK_ID,
    kind: "input",
    semantic: "data",
    valueType: "string",
    label: "Artwork Id",
    optional: true,
} as const;

const indexIn = {
    id: PIN_INDEX,
    kind: "input",
    semantic: "data",
    valueType: "integer",
    label: "Index",
    allowInlineLiteral: true,
} as const;

function artworkParam() {
    return {
        key: PARAM_ARTWORK,
        label: "Artwork",
        kind: "select" as const,
        dynamicOptionsSource: DYNAMIC_OPTIONS_SOURCE,
    };
}

function variantParam(emptyOptionLabel: string) {
    return {
        key: PARAM_VARIANT,
        label: "Variant",
        kind: "select" as const,
        dynamicOptionsSource: VARIANT_OPTIONS_SOURCE,
        emptyOptionLabel,
        // Only offer variants belonging to the artwork picked above.
        dynamicOptionsFilter: {
            paramKey: PARAM_ARTWORK,
            optionMetaKey: "artworkId",
        },
    };
}

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function readIndex(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    const parsed = Number.parseInt(readString(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getHostApi(ctx: ExecuteCtx) {
    const hostApi = ctx.hostAdapter.blueprintRuntime?.hostApi;
    if (!hostApi) {
        throw new Error("Gallery nodes require game host APIs");
    }
    return hostApi;
}

/**
 * The wired Artwork Id pin wins over the inspector selection, so a graph can
 * drive these nodes dynamically while still reading well when authored by hand.
 */
function resolveArtworkId(ctx: ExecuteCtx): string {
    return readString(ctx.resolveInput?.(PIN_ARTWORK_ID)) || readString(ctx.params[PARAM_ARTWORK]);
}

function requireArtwork(ctx: ExecuteCtx, artworks: GalleryArtwork[]): GalleryArtwork {
    const artworkId = resolveArtworkId(ctx);
    if (!artworkId) {
        throw new Error("Pick a gallery artwork");
    }
    const artwork = findArtwork(artworks, artworkId);
    if (!artwork) {
        throw new Error(`Gallery artwork not found: ${artworkId}`);
    }
    return artwork;
}

/**
 * Variants targeted by a lock/unlock node: the chosen one, or every variant of
 * the artwork when the picker is left empty. The empty case preserves the
 * pre-split behaviour of these nodes, whose param used to mean "the artwork".
 */
function resolveTargetVariants(ctx: ExecuteCtx, artwork: GalleryArtwork): GalleryVariant[] {
    const variantId = readString(ctx.params[PARAM_VARIANT]);
    if (!variantId) {
        return artwork.variants;
    }
    const variant = artwork.variants.find(candidate => candidate.id === variantId);
    return variant ? [variant] : [];
}

export function createGalleryBlueprintNodes(readCatalog: GalleryCatalogReader): BlueprintNodeDef[] {
    const catalog = (): GalleryArtwork[] => normalizeGalleryCatalog(readCatalog());

    /** Unlock reads are always catalog-aware; see readUnlockedVariantIds. */
    const readUnlocked = async (ctx: ExecuteCtx, artworks: GalleryArtwork[]): Promise<Set<string>> => {
        const stored = await getHostApi(ctx).persistence.get(RUNTIME_UNLOCKED_KEY);
        return readUnlockedVariantIds(stored, artworks);
    };

    const writeUnlocked = async (ctx: ExecuteCtx, unlocked: Set<string>): Promise<void> => {
        await getHostApi(ctx).persistence.set(RUNTIME_UNLOCKED_KEY, Array.from(unlocked));
    };

    const setVariantsLocked = async (ctx: ExecuteCtx, mode: "add" | "remove") => {
        const artworks = catalog();
        const artwork = requireArtwork(ctx, artworks);
        const targets = resolveTargetVariants(ctx, artwork);
        const unlocked = await readUnlocked(ctx, artworks);
        for (const variant of targets) {
            if (mode === "add") {
                unlocked.add(variant.id);
            } else {
                unlocked.delete(variant.id);
            }
        }
        await writeUnlocked(ctx, unlocked);
    };

    return [
        {
            type: `${PLUGIN_ID}.add`,
            displayName: "Unlock Gallery Variant",
            category: "Gallery",
            keywords: ["gallery", "unlock", "add", "cg", "variant"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [execIn, artworkIdIn, execNext],
            inspectorParams: [artworkParam(), variantParam("All variants")],
            execute: async ctx => {
                await setVariantsLocked(ctx, "add");
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.remove`,
            displayName: "Lock Gallery Variant",
            category: "Gallery",
            keywords: ["gallery", "lock", "remove", "cg", "variant"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [execIn, artworkIdIn, execNext],
            inspectorParams: [artworkParam(), variantParam("All variants")],
            execute: async ctx => {
                await setVariantsLocked(ctx, "remove");
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.clear`,
            displayName: "Clear Gallery",
            category: "Gallery",
            keywords: ["gallery", "clear", "reset"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [execIn, execNext],
            execute: async ctx => {
                await getHostApi(ctx).persistence.set(RUNTIME_UNLOCKED_KEY, []);
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.isUnlocked`,
            displayName: "Is Gallery Unlocked",
            category: "Gallery",
            keywords: ["gallery", "unlocked", "has", "cg", "variant"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                artworkIdIn,
                execNext,
                { id: "unlocked", kind: "output", semantic: "data", valueType: "boolean", label: "Unlocked" },
            ],
            // Empty variant asks about the artwork as a whole, which is the
            // common case for graying out a gallery grid cell.
            inspectorParams: [artworkParam(), variantParam("Any variant")],
            execute: async ctx => {
                const artworks = catalog();
                const artwork = requireArtwork(ctx, artworks);
                const unlocked = await readUnlocked(ctx, artworks);
                const variantId = readString(ctx.params[PARAM_VARIANT]);
                return {
                    nextPort: "next",
                    outputValues: {
                        unlocked: variantId
                            ? unlocked.has(variantId)
                            : isArtworkUnlocked(artwork, unlocked),
                    },
                };
            },
        },
        {
            type: `${PLUGIN_ID}.getVariantCount`,
            displayName: "Get Gallery Variant Count",
            category: "Gallery",
            keywords: ["gallery", "variant", "count", "length", "cg"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                execIn,
                artworkIdIn,
                execNext,
                { id: "count", kind: "output", semantic: "data", valueType: "integer", label: "Count" },
            ],
            inspectorParams: [artworkParam()],
            // Counts every authored variant, locked ones included, so a gallery
            // can render placeholder slots for what the player has not found.
            execute: ctx => ({
                nextPort: "next",
                outputValues: { count: requireArtwork(ctx, catalog()).variants.length },
            }),
        },
        {
            type: `${PLUGIN_ID}.getVariant`,
            displayName: "Get Gallery Variant",
            category: "Gallery",
            keywords: ["gallery", "variant", "image", "cg", "differential"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                artworkIdIn,
                indexIn,
                execNext,
                {
                    id: "image",
                    kind: "output",
                    semantic: "data",
                    valueType: VALUE_TYPE_IMAGE_ASSET_NULLABLE,
                    label: "Image",
                },
                { id: "unlocked", kind: "output", semantic: "data", valueType: "boolean", label: "Unlocked" },
                { id: "name", kind: "output", semantic: "data", valueType: "string", label: "Name" },
                { id: "variantId", kind: "output", semantic: "data", valueType: "string", label: "Variant Id" },
            ],
            inspectorParams: [artworkParam()],
            execute: async ctx => {
                const artworks = catalog();
                const artwork = requireArtwork(ctx, artworks);
                const variant = artwork.variants[readIndex(ctx.resolveInput?.(PIN_INDEX))];
                if (!variant) {
                    return {
                        nextPort: "next",
                        outputValues: { image: null, unlocked: false, name: "", variantId: "" },
                    };
                }
                const unlocked = await readUnlocked(ctx, artworks);
                const isUnlocked = unlocked.has(variant.id);
                return {
                    nextPort: "next",
                    outputValues: {
                        // Locked variants read as null so the UI can draw a
                        // silhouette without needing a separate check.
                        image: isUnlocked ? toImageAssetValue(variant.imageAssetId) : null,
                        unlocked: isUnlocked,
                        name: variant.name,
                        variantId: variant.id,
                    },
                };
            },
        },
        {
            type: `${PLUGIN_ID}.getCover`,
            displayName: "Get Gallery Cover",
            category: "Gallery",
            keywords: ["gallery", "cover", "thumbnail", "image", "cg"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                artworkIdIn,
                execNext,
                {
                    id: "image",
                    kind: "output",
                    semantic: "data",
                    valueType: VALUE_TYPE_IMAGE_ASSET_NULLABLE,
                    label: "Image",
                },
                { id: "unlocked", kind: "output", semantic: "data", valueType: "boolean", label: "Unlocked" },
                { id: "name", kind: "output", semantic: "data", valueType: "string", label: "Name" },
            ],
            inspectorParams: [artworkParam()],
            execute: async ctx => {
                const artworks = catalog();
                const artwork = requireArtwork(ctx, artworks);
                const cover = resolveCoverVariant(artwork);
                const unlocked = await readUnlocked(ctx, artworks);
                const isUnlocked = Boolean(cover && unlocked.has(cover.id));
                return {
                    nextPort: "next",
                    outputValues: {
                        image: isUnlocked ? toImageAssetValue(cover?.imageAssetId) : null,
                        unlocked: isUnlocked,
                        name: artwork.name,
                    },
                };
            },
        },
        {
            type: `${PLUGIN_ID}.getArtworkCount`,
            displayName: "Get Gallery Artwork Count",
            category: "Gallery",
            keywords: ["gallery", "artwork", "count", "length", "cg"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                execIn,
                execNext,
                { id: "count", kind: "output", semantic: "data", valueType: "integer", label: "Count" },
            ],
            execute: () => ({
                nextPort: "next",
                outputValues: { count: catalog().length },
            }),
        },
        {
            type: `${PLUGIN_ID}.getArtworkAt`,
            displayName: "Get Gallery Artwork At",
            category: "Gallery",
            keywords: ["gallery", "artwork", "index", "iterate", "cg"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                indexIn,
                execNext,
                { id: "artworkId", kind: "output", semantic: "data", valueType: "string", label: "Artwork Id" },
                { id: "name", kind: "output", semantic: "data", valueType: "string", label: "Name" },
                { id: "unlocked", kind: "output", semantic: "data", valueType: "boolean", label: "Unlocked" },
                { id: "variantCount", kind: "output", semantic: "data", valueType: "integer", label: "Variant Count" },
            ],
            // Pairs with Get Gallery Artwork Count to walk the whole gallery;
            // feed artworkId into the artwork-scoped nodes above.
            execute: async ctx => {
                const artworks = catalog();
                const artwork = artworks[readIndex(ctx.resolveInput?.(PIN_INDEX))];
                if (!artwork) {
                    return {
                        nextPort: "next",
                        outputValues: { artworkId: "", name: "", unlocked: false, variantCount: 0 },
                    };
                }
                const unlocked = await readUnlocked(ctx, artworks);
                return {
                    nextPort: "next",
                    outputValues: {
                        artworkId: artwork.id,
                        name: artwork.name,
                        unlocked: isArtworkUnlocked(artwork, unlocked),
                        variantCount: artwork.variants.length,
                    },
                };
            },
        },
    ];
}
