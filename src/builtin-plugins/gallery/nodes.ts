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
 * capability-gated plugin storage declared as `store` in the manifest, and only
 * ever through `unlockRecord.ts`, which runs one change at a time against the
 * runtime's own collecting. No other host power is touched.
 */

import type { PluginBlueprintNodeDef } from "narraleaf-studio/plugin";
import {
    artworkUnlockIds,
    computeGalleryStats,
    localizeGalleryStore,
    findArtwork,
    isArtworkUnlocked,
    normalizeGalleryStore,
    GALLERY_ENTRY_KINDS,
    type GalleryEntryKind,
    projectGalleryEntries,
    projectGalleryVariants,
    resolveCoverVariant,
    shownGalleryName,
    toImageAssetValue,
    type GalleryArtwork,
    type GalleryStoreData,
    PLUGIN_ID,
} from "./catalog";
import { readUnlockRecord, replaceUnlockRecord, updateUnlockRecord } from "./unlockRecord";

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

/**
 * The rows the three list readers hand out, typed by the shapes this plugin declares in its manifest
 * (`contributes.structs`). Typed, a row's fields are on the menu when a wire is dragged off it, and a
 * list given the matching shape takes them with its fields locked to the plugin's.
 */
const VALUE_TYPE_ENTRIES = "array<struct:narraleaf.gallery.entry>";
const VALUE_TYPE_VARIANTS = "array<struct:narraleaf.gallery.variant>";
const VALUE_TYPE_GROUPS = "array<struct:narraleaf.gallery.group>";

const PARAM_ARTWORK = "galleryItemId";
const PARAM_VARIANT = "galleryVariantId";
const PARAM_GROUP = "galleryGroupId";
const PARAM_KIND = "galleryKind";
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
    valueType: VALUE_TYPE_ENTRIES,
    label: "Entries",
} as const;
const variantsOut = { ...entriesOut, valueType: VALUE_TYPE_VARIANTS } as const;
const groupsOut = { ...entriesOut, id: "groups", valueType: VALUE_TYPE_GROUPS, label: "Groups" } as const;

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

/**
 * What each EXTRA column is called. The node inspector offers these as the Kind
 * options, and the editor tab and the panel name their columns with the same
 * words (through {@link GALLERY_NODE_TRANSLATIONS}), so a step that says
 * "Kind = Music" names the option the author will find in the dropdown.
 */
export const GALLERY_KIND_LABELS: Record<GalleryEntryKind, string> = {
    cg: "CG",
    scene: "Recollection",
    music: "Music",
    voice: "Voice",
};

/** The palette category every node below sits in. The panel and the editor tab carry the same name. */
export const GALLERY_CATEGORY = "Gallery";

/**
 * The nodes' words in other languages, keyed by the English text the
 * declarations below use. Studio draws a node's title, category and labels
 * through it (see `BlueprintNodeDeclaration.translations`), and the panel and
 * the editor tab read it for the words they share with the nodes.
 *
 * Words Studio's own catalogue already translates - In, Next, Count, Entries,
 * Image, Index, Group, Name, Variant - read the host's way whatever is written
 * here, so they are left out; `CG` reads the same in every language. The test
 * beside this file holds the table to exactly the words the nodes use.
 */
const zhNodeWords = {
    "Gallery": "画廊",
    "Get Gallery": "获取画廊条目",
    "Get Gallery Variants": "获取画廊变体",
    "Get Gallery Groups": "获取画廊分组",
    "Get Gallery Progress": "获取画廊进度",
    "Unlock Gallery": "解锁画廊条目",
    "Lock Gallery": "锁定画廊条目",
    "Unlock Whole Gallery": "解锁整个画廊",
    "Lock Whole Gallery": "锁定整个画廊",
    "Is Gallery Unlocked": "画廊条目是否已解锁",
    "Get Gallery Variant At": "按索引获取画廊变体",
    "Get Gallery Variant Count": "获取画廊变体数量",
    "Get Gallery Cover": "获取画廊封面",
    "Get Gallery Artwork Count": "获取画廊条目数量",
    "Get Gallery Artwork At": "按索引获取画廊条目",
    "Artwork": "条目",
    "Artwork Id": "条目 Id",
    "Variant Id": "变体 Id",
    "Variant Count": "变体数量",
    "Group Id": "分组 Id",
    "Groups": "分组列表",
    "Only Unlocked": "仅已解锁",
    "Unlocked": "已解锁",
    "Unlocked Count": "已解锁数量",
    "Total": "总数",
    "Percent": "百分比",
    "Variant Total": "变体总数",
    "Variant Unlocked": "已解锁变体数",
    "All groups": "全部分组",
    "All variants": "全部变体",
    "Any variant": "任一变体",
    "Kind": "类型",
    "All kinds": "全部类型",
    "Recollection": "回想",
    "Music": "音乐",
    "Voice": "配音",
};

const jaNodeWords: Record<keyof typeof zhNodeWords, string> = {
    "Gallery": "ギャラリー",
    "Get Gallery": "ギャラリーの項目を取得",
    "Get Gallery Variants": "ギャラリーのバリアントを取得",
    "Get Gallery Groups": "ギャラリーのグループを取得",
    "Get Gallery Progress": "ギャラリーの進捗を取得",
    "Unlock Gallery": "ギャラリーの項目を解放",
    "Lock Gallery": "ギャラリーの項目をロック",
    "Unlock Whole Gallery": "ギャラリーをすべて解放",
    "Lock Whole Gallery": "ギャラリーをすべてロック",
    "Is Gallery Unlocked": "ギャラリーの項目が解放済みか",
    "Get Gallery Variant At": "ギャラリーの指定位置のバリアントを取得",
    "Get Gallery Variant Count": "ギャラリーのバリアントの数を取得",
    "Get Gallery Cover": "ギャラリーのカバーを取得",
    "Get Gallery Artwork Count": "ギャラリーの項目数を取得",
    "Get Gallery Artwork At": "ギャラリーの指定位置の項目を取得",
    "Artwork": "項目",
    "Artwork Id": "項目 Id",
    "Variant Id": "バリアント Id",
    "Variant Count": "バリアントの個数",
    "Group Id": "グループ Id",
    "Groups": "グループ一覧",
    "Only Unlocked": "解放済みのみ",
    "Unlocked": "解放済み",
    "Unlocked Count": "解放済みの個数",
    "Total": "総数",
    "Percent": "パーセント",
    "Variant Total": "バリアントの総数",
    "Variant Unlocked": "解放済みのバリアントの個数",
    "All groups": "すべてのグループ",
    "All variants": "すべてのバリアント",
    "Any variant": "いずれかのバリアント",
    "Kind": "種類",
    "All kinds": "すべての種類",
    "Recollection": "回想",
    "Music": "音楽",
    "Voice": "ボイス",
};

export const GALLERY_NODE_TRANSLATIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    zh: zhNodeWords,
    ja: jaNodeWords,
};

/**
 * Which EXTRA column this node reads. Static options rather than a dynamic
 * source: the kinds are a closed set in the plugin's own code, not project data.
 */
function kindParam() {
    return {
        key: PARAM_KIND,
        label: "Kind",
        kind: "select" as const,
        emptyOptionLabel: "All kinds",
        options: GALLERY_ENTRY_KINDS.map(kind => ({ value: kind, label: GALLERY_KIND_LABELS[kind] })),
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
 * The plugin storage the unlock record lives in, or null.
 *
 * `app.game.store` is the plugin's own persistent area beside the player's saves
 * - it survives starting a new game, which is exactly what unlocked CGs need. It
 * is absent wherever the environment cannot back the `store` capability, notably
 * the editor, where there is no player at all. Reading then degrades to "nothing
 * unlocked" so a gallery previews as a locked grid instead of throwing, and a
 * write is dropped with a warning.
 */
function unlockStore(ctx: ExecuteCtx) {
    return ctx.game.store ?? null;
}

function warnUnpersisted(ctx: ExecuteCtx): void {
    ctx.game.log("warning", "gallery unlocks are not persisted here: plugin storage is unavailable");
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

/** Unknown or empty means every kind, so a stale param never empties a gallery. */
function resolveKind(ctx: ExecuteCtx): GalleryEntryKind | null {
    const raw = readString(ctx.params[PARAM_KIND]);
    return GALLERY_ENTRY_KINDS.includes(raw as GalleryEntryKind) ? raw as GalleryEntryKind : null;
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
 * Unlock-record ids targeted by a lock/unlock node: the chosen variant, or the
 * whole artwork when neither the pin nor the picker names one. The empty case
 * preserves the pre-split behaviour of these nodes, whose param used to mean
 * "the artwork" - and reaches an entry with no variants yet, which is recorded
 * by its own id (see `artworkUnlockIds`).
 */
function resolveTargetIds(ctx: ExecuteCtx, artwork: GalleryArtwork): string[] {
    const variantId = resolveVariantId(ctx);
    if (!variantId) {
        return artworkUnlockIds(artwork);
    }
    return artwork.variants.some(candidate => candidate.id === variantId) ? [variantId] : [];
}

function countUnlockedRows(rows: readonly { unlocked: boolean }[]): number {
    return rows.reduce((total, row) => total + (row.unlocked ? 1 : 0), 0);
}

export function createGalleryBlueprintNodes(readCatalog: GalleryCatalogReader): PluginBlueprintNodeDef[] {
    return declareGalleryBlueprintNodes(readCatalog).map(def => ({
        ...def,
        translations: GALLERY_NODE_TRANSLATIONS,
    }));
}

function declareGalleryBlueprintNodes(readCatalog: GalleryCatalogReader): PluginBlueprintNodeDef[] {
    /**
     * The catalog, with the words the author wrote in the player's language when the node runs in a
     * game (`localizeGalleryStore`). In the editor there is no `locale` on the game object and the
     * words read as written, which is the project's source language.
     */
    const store = (ctx: ExecuteCtx): GalleryStoreData => {
        const data = normalizeGalleryStore(readCatalog());
        const locale = ctx.game.locale;
        return locale ? localizeGalleryStore(data, (id, text) => locale.words(id, text)) : data;
    };

    /** Unlock reads are always catalog-aware; see readUnlockedVariantIds. */
    const readUnlocked = async (ctx: ExecuteCtx, artworks: GalleryArtwork[]): Promise<Set<string>> => {
        const backing = unlockStore(ctx);
        return backing ? await readUnlockRecord(backing, artworks) : new Set();
    };

    const setVariantsLocked = async (ctx: ExecuteCtx, mode: "add" | "remove") => {
        const data = store(ctx);
        const artwork = requireArtwork(ctx, data.items);
        const targets = resolveTargetIds(ctx, artwork);
        const backing = unlockStore(ctx);
        if (!backing) {
            warnUnpersisted(ctx);
            return;
        }
        await updateUnlockRecord(backing, data.items, unlocked => {
            for (const id of targets) {
                if (mode === "add") {
                    unlocked.add(id);
                } else {
                    unlocked.delete(id);
                }
            }
        });
    };

    const replaceUnlocked = async (ctx: ExecuteCtx, ids: string[]) => {
        const backing = unlockStore(ctx);
        if (!backing) {
            warnUnpersisted(ctx);
            return;
        }
        await replaceUnlockRecord(backing, ids);
    };

    return [
        // ---------------------------------------------------------------
        // Primary: whole-collection reads that feed a List widget directly.
        // ---------------------------------------------------------------
        {
            type: `${PLUGIN_ID}.getEntries`,
            // Every string this hands out is read from the catalogue the author wrote, which ships
            // with the game as published data - so a picture or a track taken from a row is one the
            // package carries. The other readers below say the same for the same reason.
            assetNames: "written",
            displayName: "Get Gallery",
            category: GALLERY_CATEGORY,
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
            inspectorParams: [kindParam(), groupParam()],
            // Wire Entries into Set List Content; each row already carries its
            // own lock state and resolved art, so the item template needs no
            // further gallery node. Kind picks the EXTRA column: CG grid,
            // recollection list, music player, voice list.
            execute: async ctx => {
                const data = store(ctx);
                const unlocked = await readUnlocked(ctx, data.items);
                const entries = projectGalleryEntries(data, unlocked, {
                    groupId: resolveGroupId(ctx),
                    kind: resolveKind(ctx),
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
            assetNames: "written",
            displayName: "Get Gallery Variants",
            category: GALLERY_CATEGORY,
            keywords: ["gallery", "variant", "differential", "cg", "list", "array", "strip"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                artworkIdIn,
                onlyUnlockedIn,
                execNext,
                variantsOut,
                countOut,
                unlockedCountOut,
            ],
            inspectorParams: [artworkParam()],
            // The differential strip of a CG viewer: same row shape as Get
            // Gallery, scoped to one artwork.
            execute: async ctx => {
                const data = store(ctx);
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
            assetNames: "written",
            displayName: "Get Gallery Groups",
            category: GALLERY_CATEGORY,
            keywords: ["gallery", "group", "category", "chapter", "tab", "section", "array"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [execIn, execNext, groupsOut, countOut],
            // Feeds a category tab bar; each row's `id` goes back into Get
            // Gallery's Group Id pin.
            execute: ctx => {
                const groups = store(ctx).groups.map((group, index) => ({
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
            category: GALLERY_CATEGORY,
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
            inspectorParams: [kindParam(), groupParam()],
            execute: async ctx => {
                const data = store(ctx);
                const unlocked = await readUnlocked(ctx, data.items);
                const stats = computeGalleryStats(data, unlocked, {
                    groupId: resolveGroupId(ctx),
                    kind: resolveKind(ctx),
                });
                return { nextPort: "next", outputValues: { ...stats } };
            },
        },

        // ---------------------------------------------------------------
        // Unlock record.
        // ---------------------------------------------------------------
        {
            type: `${PLUGIN_ID}.add`,
            displayName: "Unlock Gallery",
            category: GALLERY_CATEGORY,
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
            category: GALLERY_CATEGORY,
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
            category: GALLERY_CATEGORY,
            keywords: ["gallery", "unlock", "all", "everything", "complete", "extras", "reward"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [execIn, execNext],
            // The "you cleared the game, here is everything" reward, and the
            // fastest way to eyeball a gallery screen while building it.
            execute: async ctx => {
                await replaceUnlocked(ctx, store(ctx).items.flatMap(artworkUnlockIds));
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.clear`,
            displayName: "Lock Whole Gallery",
            category: GALLERY_CATEGORY,
            keywords: ["gallery", "clear", "reset", "lock", "all", "wipe"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [execIn, execNext],
            execute: async ctx => {
                await replaceUnlocked(ctx, []);
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.isUnlocked`,
            displayName: "Is Gallery Unlocked",
            category: GALLERY_CATEGORY,
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
                const data = store(ctx);
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
            assetNames: "written",
            displayName: "Get Gallery Variant At",
            category: GALLERY_CATEGORY,
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
                const data = store(ctx);
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
                        // Masked like the rows of Get Gallery Variants: a viewer stepping
                        // through differentials must not spell out the one still locked.
                        name: shownGalleryName(variant.name, isUnlocked, data.settings),
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
            category: GALLERY_CATEGORY,
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
                outputValues: { count: requireArtwork(ctx, store(ctx).items).variants.length },
            }),
        },
        {
            type: `${PLUGIN_ID}.getCover`,
            assetNames: "written",
            displayName: "Get Gallery Cover",
            category: GALLERY_CATEGORY,
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
                const data = store(ctx);
                const artwork = requireArtwork(ctx, data.items);
                const cover = resolveCoverVariant(artwork);
                const unlocked = await readUnlocked(ctx, data.items);
                const isUnlocked = Boolean(cover && unlocked.has(cover.id));
                return {
                    nextPort: "next",
                    outputValues: {
                        image: isUnlocked ? toImageAssetValue(cover?.imageAssetId) : null,
                        unlocked: isUnlocked,
                        name: shownGalleryName(artwork.name, isUnlocked, data.settings),
                    },
                };
            },
        },
        {
            type: `${PLUGIN_ID}.getArtworkCount`,
            displayName: "Get Gallery Artwork Count",
            category: GALLERY_CATEGORY,
            keywords: ["gallery", "artwork", "count", "length", "cg"],
            graphKinds: ["event", "macro"],
            hideInPalette: true,
            isPure: false,
            pins: [execIn, execNext, countOut],
            execute: ctx => ({
                nextPort: "next",
                outputValues: { count: store(ctx).items.length },
            }),
        },
        {
            type: `${PLUGIN_ID}.getArtworkAt`,
            assetNames: "written",
            displayName: "Get Gallery Artwork At",
            category: GALLERY_CATEGORY,
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
                const data = store(ctx);
                const artwork = data.items[readIndex(ctx.resolveInput?.(PIN_INDEX))];
                if (!artwork) {
                    return {
                        nextPort: "next",
                        outputValues: { artworkId: "", name: "", unlocked: false, variantCount: 0 },
                    };
                }
                const unlocked = await readUnlocked(ctx, data.items);
                const isUnlocked = isArtworkUnlocked(artwork, unlocked);
                return {
                    nextPort: "next",
                    outputValues: {
                        artworkId: artwork.id,
                        name: shownGalleryName(artwork.name, isUnlocked, data.settings),
                        unlocked: isUnlocked,
                        variantCount: artwork.variants.length,
                    },
                };
            },
        },
    ];
}
