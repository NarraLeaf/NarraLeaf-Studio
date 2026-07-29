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
 * ## Node shape
 *
 * The primary nodes return a whole **array** of rows - `Get Gallery`,
 * `Get Gallery Variants`, `Get Gallery Groups`. That is the platform's idiom for
 * screens built out of data (see the built-in `Get History`): one node feeds
 * `Set List Content`, and the item template reads each field with
 * `Get List Item Props` + `Get JSON Field`. The older count/index nodes are still
 * registered for graphs that use them, but they are hidden from the palette:
 * hand-rolling a for-loop over `Get Gallery Artwork Count` is exactly the
 * authoring cost these array nodes exist to remove.
 *
 * Note every value-producing node is `isPure: false` with exec pins. Pure nodes
 * are resolved by the host's own data resolver, which only knows built-in node
 * types - a pure plugin node's execute would never run and its outputs would
 * always be empty. Rows therefore carry every field a cell needs (`unlocked`,
 * `image`, `name`), so an item template never needs a per-cell gallery lookup.
 *
 * The unlock record is read and written through `app.game.store`, the
 * capability-gated plugin storage declared as `store` in the manifest. No other
 * host power is touched.
 */

import type { PluginBlueprintNodeDef } from "narraleaf-studio/plugin";
import {
    computeGalleryStats,
    findArtwork,
    isArtworkUnlocked,
    normalizeGalleryStore,
    projectGalleryEntries,
    projectGalleryVariants,
    readUnlockedVariantIds,
    resolveCoverVariant,
    toImageAssetValue,
    type GalleryArtwork,
    type GalleryStoreData,
    type GalleryVariant,
    PLUGIN_ID,
    RUNTIME_UNLOCKED_KEY,
} from "./catalog";

export { PLUGIN_ID, RUNTIME_UNLOCKED_KEY, GALLERY_STORE_NAMESPACE } from "./catalog";

/** Dynamic select option source ids, provided by the studio entry. */
export const DYNAMIC_OPTIONS_SOURCE = `${PLUGIN_ID}.items`;
export const VARIANT_OPTIONS_SOURCE = `${PLUGIN_ID}.variants`;
export const GROUP_OPTIONS_SOURCE = `${PLUGIN_ID}.groups`;

/**
 * Host value type tags. Written literally because plugins cannot import the
 * host's valueTypes module. `ImageAsset|null` is the nullable form: a locked or
 * imageless variant yields null, and every built-in image consumer accepts it.
 */
const VALUE_TYPE_IMAGE_ASSET_NULLABLE = "ImageAsset|null";
const VALUE_TYPE_ARRAY = "array";

const PARAM_ARTWORK = "galleryItemId";
const PARAM_VARIANT = "galleryVariantId";
const PARAM_GROUP = "galleryGroupId";
const PIN_ARTWORK_ID = "artworkId";
const PIN_VARIANT_ID = "variantId";
const PIN_GROUP_ID = "groupId";
const PIN_ONLY_UNLOCKED = "onlyUnlocked";
const PIN_INDEX = "index";

type ExecuteCtx = Parameters<PluginBlueprintNodeDef["execute"]>[0];

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

/**
 * Same override for the variant. This is what lets a CG viewer unlock or inspect
 * the differential the player is actually looking at: the id comes off the list
 * row, not out of a dropdown fixed at author time.
 */
const variantIdIn = {
    id: PIN_VARIANT_ID,
    kind: "input",
    semantic: "data",
    valueType: "string",
    label: "Variant Id",
    optional: true,
} as const;

const groupIdIn = {
    id: PIN_GROUP_ID,
    kind: "input",
    semantic: "data",
    valueType: "string",
    label: "Group Id",
    optional: true,
} as const;

/** Inline literal so the common case is a checkbox on the card, not a wired Boolean node. */
const onlyUnlockedIn = {
    id: PIN_ONLY_UNLOCKED,
    kind: "input",
    semantic: "data",
    valueType: "boolean",
    label: "Only Unlocked",
    optional: true,
    allowInlineLiteral: true,
} as const;

const indexIn = {
    id: PIN_INDEX,
    kind: "input",
    semantic: "data",
    valueType: "integer",
    label: "Index",
    allowInlineLiteral: true,
} as const;

const entriesOut = {
    id: "entries",
    kind: "output",
    semantic: "data",
    valueType: VALUE_TYPE_ARRAY,
    label: "Entries",
} as const;

const countOut = { id: "count", kind: "output", semantic: "data", valueType: "integer", label: "Count" } as const;
const unlockedCountOut = {
    id: "unlockedCount",
    kind: "output",
    semantic: "data",
    valueType: "integer",
    label: "Unlocked Count",
} as const;

function artworkParam(label = "Artwork") {
    return {
        key: PARAM_ARTWORK,
        label,
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

function groupParam() {
    return {
        key: PARAM_GROUP,
        label: "Group",
        kind: "select" as const,
        dynamicOptionsSource: GROUP_OPTIONS_SOURCE,
        emptyOptionLabel: "All groups",
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

/**
 * Read the persisted unlock record.
 *
 * `app.game.store` is the plugin's own persistent area beside the player's saves
 * - it survives starting a new game, which is exactly what unlocked CGs need. It
 * is absent wherever the environment cannot back the `store` capability, notably
 * the editor, where there is no player at all. Reading then degrades to "nothing
 * unlocked" so a gallery previews as a locked grid instead of throwing.
 */
async function readStoredUnlocked(ctx: ExecuteCtx): Promise<unknown> {
    return ctx.game.store ? await ctx.game.store.get(RUNTIME_UNLOCKED_KEY) : null;
}

/** Writes are dropped with a warning when the store is absent; see readStoredUnlocked. */
async function writeStoredUnlocked(ctx: ExecuteCtx, variantIds: string[]): Promise<void> {
    if (!ctx.game.store) {
        ctx.game.log("warning", "gallery unlocks are not persisted here: plugin storage is unavailable");
        return;
    }
    await ctx.game.store.set(RUNTIME_UNLOCKED_KEY, variantIds);
}

/**
 * The wired pin wins over the inspector selection, so a graph can drive these
 * nodes dynamically while still reading well when authored by hand.
 */
function resolveArtworkId(ctx: ExecuteCtx): string {
    return readString(ctx.resolveInput?.(PIN_ARTWORK_ID)) || readString(ctx.params[PARAM_ARTWORK]);
}

function resolveVariantId(ctx: ExecuteCtx): string {
    return readString(ctx.resolveInput?.(PIN_VARIANT_ID)) || readString(ctx.params[PARAM_VARIANT]);
}

function resolveGroupId(ctx: ExecuteCtx): string {
    return readString(ctx.resolveInput?.(PIN_GROUP_ID)) || readString(ctx.params[PARAM_GROUP]);
}

function resolveOnlyUnlocked(ctx: ExecuteCtx): boolean {
    return ctx.resolveInput?.(PIN_ONLY_UNLOCKED) === true;
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
 * the artwork when neither the pin nor the picker names one. The empty case
 * preserves the pre-split behaviour of these nodes, whose param used to mean
 * "the artwork".
 */
function resolveTargetVariants(ctx: ExecuteCtx, artwork: GalleryArtwork): GalleryVariant[] {
    const variantId = resolveVariantId(ctx);
    if (!variantId) {
        return artwork.variants;
    }
    const variant = artwork.variants.find(candidate => candidate.id === variantId);
    return variant ? [variant] : [];
}

function countUnlockedRows(rows: readonly { unlocked: boolean }[]): number {
    return rows.reduce((total, row) => total + (row.unlocked ? 1 : 0), 0);
}

export function createGalleryBlueprintNodes(readCatalog: GalleryCatalogReader): PluginBlueprintNodeDef[] {
    const store = (): GalleryStoreData => normalizeGalleryStore(readCatalog());

    /** Unlock reads are always catalog-aware; see readUnlockedVariantIds. */
    const readUnlocked = async (ctx: ExecuteCtx, artworks: GalleryArtwork[]): Promise<Set<string>> => {
        return readUnlockedVariantIds(await readStoredUnlocked(ctx), artworks);
    };

    const writeUnlocked = async (ctx: ExecuteCtx, unlocked: Set<string>): Promise<void> => {
        await writeStoredUnlocked(ctx, Array.from(unlocked));
    };

    const setVariantsLocked = async (ctx: ExecuteCtx, mode: "add" | "remove") => {
        const data = store();
        const artwork = requireArtwork(ctx, data.items);
        const targets = resolveTargetVariants(ctx, artwork);
        const unlocked = await readUnlocked(ctx, data.items);
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
        // ---------------------------------------------------------------
        // Primary: whole-collection reads that feed a List widget directly.
        // ---------------------------------------------------------------
        {
            type: `${PLUGIN_ID}.getEntries`,
            displayName: "Get Gallery",
            category: "Gallery",
            keywords: ["gallery", "cg", "entries", "items", "list", "grid", "array", "artworks"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                groupIdIn,
                onlyUnlockedIn,
                execNext,
                entriesOut,
                countOut,
                unlockedCountOut,
            ],
            inspectorParams: [groupParam()],
            // Wire Entries into Set List Content; each row already carries its
            // own lock state and resolved art, so the item template needs no
            // further gallery node.
            execute: async ctx => {
                const data = store();
                const unlocked = await readUnlocked(ctx, data.items);
                const entries = projectGalleryEntries(data, unlocked, {
                    groupId: resolveGroupId(ctx),
                    onlyUnlocked: resolveOnlyUnlocked(ctx),
                });
                return {
                    nextPort: "next",
                    outputValues: {
                        entries,
                        count: entries.length,
                        unlockedCount: countUnlockedRows(entries),
                    },
                };
            },
        },
        {
            type: `${PLUGIN_ID}.getVariants`,
            displayName: "Get Gallery Variants",
            category: "Gallery",
            keywords: ["gallery", "variant", "differential", "cg", "list", "array", "strip"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                artworkIdIn,
                onlyUnlockedIn,
                execNext,
                entriesOut,
                countOut,
                unlockedCountOut,
            ],
            inspectorParams: [artworkParam()],
            // The differential strip of a CG viewer: same row shape as Get
            // Gallery, scoped to one artwork.
            execute: async ctx => {
                const data = store();
                const artwork = requireArtwork(ctx, data.items);
                const unlocked = await readUnlocked(ctx, data.items);
                const entries = projectGalleryVariants(data, artwork, unlocked, {
                    onlyUnlocked: resolveOnlyUnlocked(ctx),
                });
                return {
                    nextPort: "next",
                    outputValues: {
                        entries,
                        count: entries.length,
                        unlockedCount: countUnlockedRows(entries),
                    },
                };
            },
        },
        {
            type: `${PLUGIN_ID}.getGroups`,
            displayName: "Get Gallery Groups",
            category: "Gallery",
            keywords: ["gallery", "group", "category", "chapter", "tab", "section", "array"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [execIn, execNext, { ...entriesOut, id: "groups", label: "Groups" }, countOut],
            // Feeds a category tab bar; each row's `id` goes back into Get
            // Gallery's Group Id pin.
            execute: () => {
                const groups = store().groups.map((group, index) => ({
                    index,
                    id: group.id,
                    name: group.name,
                }));
                return {
                    nextPort: "next",
                    outputValues: { groups, count: groups.length },
                };
            },
        },
        {
            type: `${PLUGIN_ID}.getStats`,
            displayName: "Get Gallery Progress",
            category: "Gallery",
            keywords: ["gallery", "progress", "completion", "percent", "stats", "count", "total"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                groupIdIn,
                execNext,
                { id: "total", kind: "output", semantic: "data", valueType: "integer", label: "Total" },
                { id: "unlocked", kind: "output", semantic: "data", valueType: "integer", label: "Unlocked" },
                { id: "percent", kind: "output", semantic: "data", valueType: "integer", label: "Percent" },
                { id: "variantTotal", kind: "output", semantic: "data", valueType: "integer", label: "Variant Total" },
                {
                    id: "variantUnlocked",
                    kind: "output",
                    semantic: "data",
                    valueType: "integer",
                    label: "Variant Unlocked",
                },
            ],
            inspectorParams: [groupParam()],
            execute: async ctx => {
                const data = store();
                const unlocked = await readUnlocked(ctx, data.items);
                const stats = computeGalleryStats(data, unlocked, { groupId: resolveGroupId(ctx) });
                return { nextPort: "next", outputValues: { ...stats } };
            },
        },

        // ---------------------------------------------------------------
        // Unlock record.
        // ---------------------------------------------------------------
        {
            type: `${PLUGIN_ID}.add`,
            displayName: "Unlock Gallery",
            category: "Gallery",
            keywords: ["gallery", "unlock", "add", "cg", "variant", "collect"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [execIn, artworkIdIn, variantIdIn, execNext],
            inspectorParams: [artworkParam(), variantParam("All variants")],
            execute: async ctx => {
                await setVariantsLocked(ctx, "add");
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.remove`,
            displayName: "Lock Gallery",
            category: "Gallery",
            keywords: ["gallery", "lock", "remove", "cg", "variant"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [execIn, artworkIdIn, variantIdIn, execNext],
            inspectorParams: [artworkParam(), variantParam("All variants")],
            execute: async ctx => {
                await setVariantsLocked(ctx, "remove");
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.unlockAll`,
            displayName: "Unlock Whole Gallery",
            category: "Gallery",
            keywords: ["gallery", "unlock", "all", "everything", "complete", "extras", "reward"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [execIn, execNext],
            // The "you cleared the game, here is everything" reward, and the
            // fastest way to eyeball a gallery screen while building it.
            execute: async ctx => {
                const data = store();
                await writeStoredUnlocked(
                    ctx,
                    data.items.flatMap(artwork => artwork.variants.map(variant => variant.id)),
                );
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.clear`,
            displayName: "Lock Whole Gallery",
            category: "Gallery",
            keywords: ["gallery", "clear", "reset", "lock", "all", "wipe"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [execIn, execNext],
            execute: async ctx => {
                await writeStoredUnlocked(ctx, []);
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.isUnlocked`,
            displayName: "Is Gallery Unlocked",
            category: "Gallery",
            keywords: ["gallery", "unlocked", "has", "cg", "variant", "check"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                artworkIdIn,
                variantIdIn,
                execNext,
                { id: "unlocked", kind: "output", semantic: "data", valueType: "boolean", label: "Unlocked" },
            ],
            // Empty variant asks about the artwork as a whole, which is the
            // common case for graying out a gallery grid cell.
            inspectorParams: [artworkParam(), variantParam("Any variant")],
            execute: async ctx => {
                const data = store();
                const artwork = requireArtwork(ctx, data.items);
                const unlocked = await readUnlocked(ctx, data.items);
                const variantId = resolveVariantId(ctx);
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

        // ---------------------------------------------------------------
        // Single-item read. Still useful for a viewer stepping prev/next
        // through one artwork's differentials.
        // ---------------------------------------------------------------
        {
            type: `${PLUGIN_ID}.getVariant`,
            displayName: "Get Gallery Variant At",
            category: "Gallery",
            keywords: ["gallery", "variant", "image", "cg", "differential", "index", "step"],
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
                const data = store();
                const artwork = requireArtwork(ctx, data.items);
                const variant = artwork.variants[readIndex(ctx.resolveInput?.(PIN_INDEX))];
                if (!variant) {
                    return {
                        nextPort: "next",
                        outputValues: { image: null, unlocked: false, name: "", variantId: "" },
                    };
                }
                const unlocked = await readUnlocked(ctx, data.items);
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

        // ---------------------------------------------------------------
        // Superseded by the array nodes above. Kept registered so existing
        // graphs keep running, hidden so new graphs are not built on them.
        // ---------------------------------------------------------------
        {
            type: `${PLUGIN_ID}.getVariantCount`,
            displayName: "Get Gallery Variant Count",
            category: "Gallery",
            keywords: ["gallery", "variant", "count", "length", "cg"],
            graphKinds: ["event", "macro"],
            hideInPalette: true,
            isPure: false,
            pins: [execIn, artworkIdIn, execNext, countOut],
            inspectorParams: [artworkParam()],
            // Counts every authored variant, locked ones included, so a gallery
            // can render placeholder slots for what the player has not found.
            execute: ctx => ({
                nextPort: "next",
                outputValues: { count: requireArtwork(ctx, store().items).variants.length },
            }),
        },
        {
            type: `${PLUGIN_ID}.getCover`,
            displayName: "Get Gallery Cover",
            category: "Gallery",
            keywords: ["gallery", "cover", "thumbnail", "image", "cg"],
            graphKinds: ["event", "macro"],
            hideInPalette: true,
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
                const data = store();
                const artwork = requireArtwork(ctx, data.items);
                const cover = resolveCoverVariant(artwork);
                const unlocked = await readUnlocked(ctx, data.items);
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
            hideInPalette: true,
            isPure: false,
            pins: [execIn, execNext, countOut],
            execute: () => ({
                nextPort: "next",
                outputValues: { count: store().items.length },
            }),
        },
        {
            type: `${PLUGIN_ID}.getArtworkAt`,
            displayName: "Get Gallery Artwork At",
            category: "Gallery",
            keywords: ["gallery", "artwork", "index", "iterate", "cg"],
            graphKinds: ["event", "macro"],
            hideInPalette: true,
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
            execute: async ctx => {
                const data = store();
                const artwork = data.items[readIndex(ctx.resolveInput?.(PIN_INDEX))];
                if (!artwork) {
                    return {
                        nextPort: "next",
                        outputValues: { artworkId: "", name: "", unlocked: false, variantCount: 0 },
                    };
                }
                const unlocked = await readUnlocked(ctx, data.items);
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
