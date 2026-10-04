/**
 * The asset browser's reading of the library: where the author is standing, what is there, and in
 * what order it is drawn.
 *
 * The browser is the bottom tray's shape of the library. The sidebar is a tall, narrow column and
 * draws the library as one tree; the tray is wide and short, so it splits the two questions a tree
 * answers at once. The folder tree on its left says *where* - the six categories and the folders
 * inside them, and nothing else - and the pane beside it says *what is here*: the contents of that
 * one place, as tiles or as a table. Every command that makes something (import, a new folder) acts
 * on that place, which the path above the contents names.
 *
 * Everything here is pure so the view, the selection's shift ranges and the tests read one answer.
 */

import { ASSET_CATEGORY_ORDER, AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import type { AssetSetCell } from "@shared/types/assetSet";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import { assetSelectionKey } from "../state/assetActionTargets";

/** A place in the library: a category's root, or a folder inside it. */
export interface AssetBrowserLocation {
    category: AssetCategory;
    groupId?: string;
}

export const DEFAULT_ASSET_BROWSER_LOCATION: AssetBrowserLocation = { category: AssetCategory.Image };

/** How many images a folder tile stacks. Four fills a 2x2 cleanly. */
export const FOLDER_PREVIEW_LIMIT = 4;

export type AssetBrowserItem =
    /** A set filed here, or the set that answers one value of the set being walked through. */
    | { key: string; kind: "set"; category: AssetCategory; entry: ResolvedAssetSet; caption?: string; movable: boolean }
    | { key: string; kind: "group"; category: AssetCategory; group: AssetGroup; childCount: number; preview: Asset[] }
    /** A file. `assetSetValue` when it is drawn as the answer to one value of a set. */
    | { key: string; kind: "asset"; category: AssetCategory; asset: Asset; caption?: string; assetSetValue?: { setId: string; value: string } }
    /** A value with no file of its own that the fallback answers, drawn as the fallback's file. */
    | { key: string; kind: "inherited"; category: AssetCategory; asset: Asset; caption: string; value: string }
    /** A value nothing answers. Drawn, because the value is why the set has a place for it. */
    | { key: string; kind: "hole"; category: AssetCategory; caption: string; value: string };

export type AssetBrowserSortKey = "name" | "format" | "size" | "usage";
export type AssetBrowserSort = { key: AssetBrowserSortKey; direction: "asc" | "desc" } | null;

/** What the browser knows about each file beyond its record. Null while it has not been measured. */
export interface AssetBrowserMeasures {
    bytesByAssetId: ReadonlyMap<string, number> | null;
    referenceCountByAssetId: ReadonlyMap<string, number> | null;
    /** Files the reference index cannot answer for. Neither used nor unused. */
    usageUnknownAssetIds: ReadonlySet<string> | null;
}

/* --- Locations ---------------------------------------------------------------------------- */

/** The folders from the category root down to `groupId`, outermost first. Empty for a root. */
export function groupPath(groupId: string | undefined, groups: readonly AssetGroup[]): AssetGroup[] {
    if (!groupId) {
        return [];
    }
    const byId = new Map(groups.map(group => [group.id, group]));
    const path: AssetGroup[] = [];
    const seen = new Set<string>();
    let current = byId.get(groupId);
    // A hand-edited folder list can hold a cycle; one that does is walked until it repeats.
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        path.unshift(current);
        current = current.parentGroupId ? byId.get(current.parentGroupId) : undefined;
    }
    return path;
}

/**
 * A remembered place brought back to one that exists.
 *
 * A folder deleted since, or one that moved to another category, leaves the author at the root of
 * the category they were in rather than in a place the library no longer has.
 */
export function resolveAssetBrowserLocation(
    location: AssetBrowserLocation | null | undefined,
    groups: Record<AssetCategory, readonly AssetGroup[]>,
): AssetBrowserLocation {
    if (!location || !ASSET_CATEGORY_ORDER.includes(location.category)) {
        return DEFAULT_ASSET_BROWSER_LOCATION;
    }
    if (!location.groupId) {
        return { category: location.category };
    }
    const exists = groups[location.category]?.some(group => group.id === location.groupId);
    return exists ? { category: location.category, groupId: location.groupId } : { category: location.category };
}

export function sameAssetBrowserLocation(a: AssetBrowserLocation | null, b: AssetBrowserLocation | null): boolean {
    if (!a || !b) {
        return a === b;
    }
    return a.category === b.category && (a.groupId ?? "") === (b.groupId ?? "");
}

/** The place one level up: the enclosing folder, then the category root. Null at a root. */
export function parentAssetBrowserLocation(
    location: AssetBrowserLocation,
    groups: Record<AssetCategory, readonly AssetGroup[]>,
): AssetBrowserLocation | null {
    if (!location.groupId) {
        return null;
    }
    const group = groups[location.category].find(entry => entry.id === location.groupId);
    return group?.parentGroupId
        ? { category: location.category, groupId: group.parentGroupId }
        : { category: location.category };
}

/** `groupId` plus every folder nested under it. */
export function subtreeGroupIds(groups: readonly AssetGroup[], rootId: string): Set<string> {
    const ids = new Set<string>([rootId]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const group of groups) {
            if (group.parentGroupId && ids.has(group.parentGroupId) && !ids.has(group.id)) {
                ids.add(group.id);
                grew = true;
            }
        }
    }
    return ids;
}

/** Every file a place holds, however deep. A category root holds the whole category. */
export function assetsInSubtree(
    assets: readonly Asset[],
    groups: readonly AssetGroup[],
    rootId: string | null | undefined,
): Asset[] {
    if (!rootId) {
        return [...assets];
    }
    const ids = subtreeGroupIds(groups, rootId);
    return assets.filter(asset => !!asset.groupId && ids.has(asset.groupId));
}

/* --- What a place holds ------------------------------------------------------------------- */

export interface AssetBrowserLibrary {
    assets: Record<AssetCategory, Asset[]>;
    groups: Record<AssetCategory, AssetGroup[]>;
    /** Every set, measured, filed by category. */
    assetSets: Record<AssetCategory, ResolvedAssetSet[]>;
    /** The sets that hang under no other set. */
    rootAssetSets: Record<AssetCategory, ResolvedAssetSet[]>;
    /** Files some set answers with. Drawn inside their set and not again beside it. */
    memberAssetIds: ReadonlySet<string>;
}

function folderItem(category: AssetCategory, group: AssetGroup, library: AssetBrowserLibrary): AssetBrowserItem {
    const childGroups = library.groups[category].filter(entry => entry.parentGroupId === group.id).length;
    const childAssets = library.assets[category]
        .filter(asset => asset.groupId === group.id && !library.memberAssetIds.has(asset.id)).length;
    const childSets = library.rootAssetSets[category].filter(entry => entry.set.groupId === group.id).length;
    const preview = assetsInSubtree(library.assets[category], library.groups[category], group.id)
        .filter(asset => asset.type === AssetType.Image)
        .slice(0, FOLDER_PREVIEW_LIMIT);
    return {
        key: "group:" + group.id,
        kind: "group",
        category,
        group,
        childCount: childGroups + childAssets + childSets,
        preview,
    };
}

/**
 * What one place holds, in the order the library files it: the sets made here, the folders, then
 * the loose files.
 *
 * `setPath` is the sets walked into from this place, outermost first. Inside a set there are no
 * folders and no loose files: what it holds is one answer per value, so the items are its values.
 * `describeCell` names a value in the project's words, which needs the axis naming the view holds.
 */
export function assetBrowserLocationItems(
    location: AssetBrowserLocation,
    setPath: readonly ResolvedAssetSet[],
    library: AssetBrowserLibrary,
    describeCell: (set: ResolvedAssetSet, cell: AssetSetCell) => string,
): AssetBrowserItem[] {
    const { category, groupId } = location;
    const insideSet = setPath.length > 0 ? setPath[setPath.length - 1] : null;
    if (insideSet) {
        return setCellItems(insideSet, library, describeCell);
    }
    const here = groupId ?? "";
    const items: AssetBrowserItem[] = [];
    for (const entry of library.rootAssetSets[category]) {
        if ((entry.set.groupId ?? "") === here) {
            items.push({ key: "set:" + entry.set.id, kind: "set", category, entry, movable: true });
        }
    }
    for (const group of library.groups[category]) {
        if ((group.parentGroupId ?? "") === here) {
            items.push(folderItem(category, group, library));
        }
    }
    for (const asset of library.assets[category]) {
        if ((asset.groupId ?? "") === here && !library.memberAssetIds.has(asset.id)) {
            items.push({ key: "asset:" + asset.id, kind: "asset", category, asset });
        }
    }
    return items;
}

function setCellItems(
    insideSet: ResolvedAssetSet,
    library: AssetBrowserLibrary,
    describeCell: (set: ResolvedAssetSet, cell: AssetSetCell) => string,
): AssetBrowserItem[] {
    const category = insideSet.category;
    const findAsset = (id: string) => library.assets[category].find(asset => asset.id === id);
    const items: AssetBrowserItem[] = [];
    for (const cell of insideSet.contents.cells) {
        const caption = describeCell(insideSet, cell);
        const key = "cell:" + cell.label;
        const child = cell.childSetIds.length === 1
            ? library.assetSets[category].find(entry => entry.set.id === cell.childSetIds[0])
            : undefined;
        if (child) {
            items.push({ key, kind: "set", category, entry: child, caption, movable: false });
            continue;
        }
        const asset = cell.assetIds.length === 1 ? findAsset(cell.assetIds[0]) : undefined;
        if (asset) {
            items.push({
                key,
                kind: "asset",
                category,
                asset,
                caption,
                assetSetValue: { setId: insideSet.set.id, value: cell.value },
            });
            continue;
        }
        // No file of its own: the fallback's file when the fallback answers the value - it is what
        // the game shows there - and the hole the value is when nothing does.
        const inherited = cell.inherited && cell.assetId ? findAsset(cell.assetId) : undefined;
        items.push(inherited
            ? { key, kind: "inherited", category, asset: inherited, caption, value: cell.value }
            : { key, kind: "hole", category, caption, value: cell.value });
    }
    return items;
}

/**
 * Everything a search or a filter left, across the whole library.
 *
 * The narrowing is the library's (`useAssetFilters`), and it searches the library rather than the
 * place the author happens to be standing in, so the results are not filed under the current place
 * and the path gives way to a count while they are up. Only folders that matched by name are hits;
 * the rest of `filteredGroups` is the ancestor scaffolding a tree needs. A file a set answers with is
 * a hit like any other: a search that skipped it would find nothing for the one file the author
 * typed. A set is a hit when its name holds the query.
 */
export function assetBrowserResultItems(input: {
    filteredAssets: Record<AssetCategory, Asset[]>;
    filteredGroups: Record<AssetCategory, AssetGroup[]>;
    matchedGroupIds: ReadonlySet<string>;
    library: AssetBrowserLibrary;
    /** Already lower-cased, as the search hands it over. Empty when only filters are narrowing. */
    query: string;
}): AssetBrowserItem[] {
    const { filteredAssets, filteredGroups, matchedGroupIds, library, query } = input;
    const items: AssetBrowserItem[] = [];
    for (const category of ASSET_CATEGORY_ORDER) {
        if (query) {
            for (const entry of library.rootAssetSets[category]) {
                if (entry.set.name.toLowerCase().includes(query)) {
                    items.push({ key: "set:" + entry.set.id, kind: "set", category, entry, movable: true });
                }
            }
        }
        for (const group of filteredGroups[category]) {
            if (matchedGroupIds.has(group.id)) {
                items.push(folderItem(category, group, library));
            }
        }
    }
    for (const category of ASSET_CATEGORY_ORDER) {
        for (const asset of filteredAssets[category]) {
            items.push({ key: "asset:" + asset.id, kind: "asset", category, asset });
        }
    }
    return items;
}

/* --- Order -------------------------------------------------------------------------------- */

/** Sets, then folders, then files: the grouping every file browser keeps under any sort. */
function kindRank(item: AssetBrowserItem): number {
    switch (item.kind) {
        case "set":
            return 0;
        case "group":
            return 1;
        default:
            return 2;
    }
}

export function assetBrowserItemName(item: AssetBrowserItem): string {
    switch (item.kind) {
        case "set":
            return item.entry.set.name;
        case "group":
            return item.group.name;
        case "hole":
            return item.caption;
        default:
            return item.asset.name;
    }
}

/** The file's extension as the table and the tiles print it. Empty for anything that is not a file. */
export function assetBrowserItemFormat(item: AssetBrowserItem): string {
    if (item.kind !== "asset" && item.kind !== "inherited") {
        return "";
    }
    return (item.asset.ext ?? "").replace(/^\./, "").toUpperCase();
}

export function assetBrowserItemBytes(item: AssetBrowserItem, measures: AssetBrowserMeasures): number | null {
    if (item.kind !== "asset") {
        return null;
    }
    return measures.bytesByAssetId?.get(item.asset.id) ?? null;
}

/**
 * How many places use the file, or null when that is not known.
 *
 * The places the index found are found, so a count above zero is said even where the index has
 * gaps for the file's type - the properties panel lists the same places. Zero is said only where
 * the index can vouch for it: "nothing uses this" is the reading an author deletes files on.
 */
export function assetBrowserItemUsage(item: AssetBrowserItem, measures: AssetBrowserMeasures): number | null {
    if (item.kind !== "asset" || !measures.referenceCountByAssetId) {
        return null;
    }
    const count = measures.referenceCountByAssetId.get(item.asset.id) ?? 0;
    if (count > 0) {
        return count;
    }
    return measures.usageUnknownAssetIds?.has(item.asset.id) ? null : 0;
}

/**
 * The items in the order the browser draws them.
 *
 * No sort is the library's own order, which is the order the author filed things in. A sort orders
 * within each kind and never mixes them. Unknown values (a size not measured yet) sort last in both
 * directions, so flipping the direction does not bring the gaps to the top.
 */
export function sortAssetBrowserItems(
    items: readonly AssetBrowserItem[],
    sort: AssetBrowserSort,
    measures: AssetBrowserMeasures,
): AssetBrowserItem[] {
    const indexed = items.map((item, index) => ({ item, index }));
    const sign = sort?.direction === "desc" ? -1 : 1;
    const compareValues = (a: AssetBrowserItem, b: AssetBrowserItem): number => {
        if (!sort) {
            return 0;
        }
        switch (sort.key) {
            case "name":
                return sign * assetBrowserItemName(a).localeCompare(assetBrowserItemName(b), undefined, { numeric: true });
            case "format":
                return sign * assetBrowserItemFormat(a).localeCompare(assetBrowserItemFormat(b));
            case "size":
                return compareNullable(assetBrowserItemBytes(a, measures), assetBrowserItemBytes(b, measures), sign);
            case "usage":
                return compareNullable(assetBrowserItemUsage(a, measures), assetBrowserItemUsage(b, measures), sign);
        }
    };
    indexed.sort((a, b) =>
        kindRank(a.item) - kindRank(b.item)
        || compareValues(a.item, b.item)
        || a.index - b.index);
    return indexed.map(entry => entry.item);
}

function compareNullable(a: number | null, b: number | null, sign: number): number {
    if (a === null && b === null) {
        return 0;
    }
    if (a === null) {
        return 1;
    }
    if (b === null) {
        return -1;
    }
    return sign * (a - b);
}

/** Header clicks walk ascending, descending, then back to the library's own order. */
export function nextAssetBrowserSort(current: AssetBrowserSort, key: AssetBrowserSortKey): AssetBrowserSort {
    if (!current || current.key !== key) {
        return { key, direction: "asc" };
    }
    return current.direction === "asc" ? { key, direction: "desc" } : null;
}

/**
 * The selection keys of the items as drawn, which is what a shift range is sliced from.
 *
 * Sets are left out (the inspector takes them, the multi-selection does not), and so are a value the
 * fallback answers and a hole: neither is a file of its own to mark.
 */
export function assetBrowserRowOrder(items: readonly AssetBrowserItem[]): string[] {
    const keys: string[] = [];
    for (const item of items) {
        if (item.kind === "group") {
            keys.push(assetSelectionKey(item.group.id, true));
        } else if (item.kind === "asset") {
            keys.push(assetSelectionKey(item.asset.id, false));
        }
    }
    return keys;
}
