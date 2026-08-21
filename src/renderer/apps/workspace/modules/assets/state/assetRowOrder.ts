import { ASSET_CATEGORY_ORDER, AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { assetSelectionKey } from "./assetActionTargets";

/**
 * The order the library's rows are drawn in, as selection keys.
 *
 * A shift range is a slice of this list, which is the whole reason it exists: the range used to be
 * sliced out of a walk of the *data* - every group, then every asset, per category - and the panel
 * has not drawn the library in that order since sets arrived. A file a set answers with is drawn
 * inside its set and not in the folder it was imported into, a collapsed folder draws nothing at
 * all, and a closed section draws nothing either. Ranging over the data therefore marked rows the
 * author could not see, and the most visible form of that was the one that was reported: shift over
 * two loose files in a folder, and every member of a set filed in the same folder came with them,
 * lighting the set up somewhere else on screen.
 *
 * So the order is what the panel is drawing, top to bottom, at the moment of the click. Rows that
 * carry no selection key at all - a set's own row, a value no single file answers - contribute
 * nothing and cannot be caught in a range; a set is not part of the library's multi-selection,
 * since nothing that acts on marked rows (copy, export, delete bytes) means anything for one.
 *
 * Each view publishes its own: the tree and the grid draw the same library in genuinely different
 * shapes - the grid shows one folder at a time and steps *into* a set rather than opening it in
 * place - and a range has to follow whichever one the author is looking at.
 */

/** One value of a set, and what the panel has to draw for it. See `AssetSetCell`. */
export interface AssetSetRowCell {
    /** Files carrying this value's tags. Exactly one is drawn as that file's own row. */
    assetIds: readonly string[];
    /** Sets hanging under this value. Exactly one is drawn as that set, one level in. */
    childSetIds: readonly string[];
}

/**
 * What the order needs of a set: where its row is filed, and what it draws under it.
 *
 * Structural rather than `ResolvedAssetSet`, so ordering can be exercised without resolving a
 * declaration against a library. This shape is the whole of what the views read to lay a set out.
 */
export interface AssetSetRows {
    set: { id: string; groupId?: string };
    contents: { cells: readonly AssetSetRowCell[] };
}

/**
 * The sets one level draws: the ones filed in this folder, or at the section's root.
 *
 * A set holds no files - its members stay in whatever folder they were imported into - so this is
 * only about where the row is drawn. Shared with the views rather than restated, because a row that
 * moves from one level to another has to move in the range at the same moment.
 */
export function assetSetsFiledIn<T extends AssetSetRows>(sets: readonly T[], groupId: string | null): T[] {
    return sets.filter(entry => (entry.set.groupId || null) === groupId);
}

/** The folders one level draws. */
export function groupsFiledIn(groups: readonly AssetGroup[], parentGroupId: string | null): AssetGroup[] {
    return groups.filter(group => (group.parentGroupId || null) === parentGroupId);
}

/**
 * The files one level draws: what is filed here, minus what a set draws instead.
 *
 * A member listed both inside its set and in the folder it was imported into reads as two copies of
 * one file, which is the one thing a set must not look like.
 */
export function assetsFiledIn(
    assets: readonly Asset[],
    groupId: string | null,
    memberAssetIds: ReadonlySet<string>,
): Asset[] {
    return assets.filter(asset => (asset.groupId || null) === groupId && !memberAssetIds.has(asset.id));
}

/**
 * What one section of the tree is laid out from.
 *
 * Which sections are open is not here: a closed section draws no rows, and deciding not to ask for
 * them is the caller's - the view walks the sections it is drawing and nothing else.
 */
export interface ListViewRowOrderInput<T extends AssetSetRows = AssetSetRows> {
    /** The library as narrowed by the search box and the filters: what the tree is listing. */
    assets: Record<AssetCategory, Asset[]>;
    groups: Record<AssetCategory, AssetGroup[]>;
    /** Sets that hang under nothing, which is what a section and a folder list. */
    rootAssetSets: Record<AssetCategory, T[]>;
    /** Every set of the section, so an open one can find the sets hanging under its values. */
    assetSets: Record<AssetCategory, T[]>;
    memberAssetIds: ReadonlySet<string>;
    expandedGroups: ReadonlySet<string>;
    expandedAssetSets: ReadonlySet<string>;
    /** While a search or a filter narrows the library every surviving folder is drawn open. */
    isNarrowed: boolean;
}

/** One value of a set as the tree lays it out. Wider than {@link AssetSetRowCell}, which is the ordering's own view. */
type RowCellOf<T extends AssetSetRows> = T["contents"]["cells"][number];

/**
 * One row of the tree, flattened.
 *
 * The tree used to draw itself through nested components, and the order above was recomputed from
 * the same rules because there was no single place a row passed through. There is one now: the view
 * windows its rows, and a windowed list is an index into a flat array by construction. So this is
 * the one walk, and {@link listViewRowOrder} is a projection of it.
 *
 * Everything a row needs to know about where it sits travels with it, because its ancestors are no
 * longer wrapped around it in the DOM: `groupPath` is what a drop on this row lands in and what a
 * hovered folder lights up, and `band` is the tint a top-level set draws the length of itself.
 */
export type ListViewRow<T extends AssetSetRows = AssetSetRows> = {
    /** Stable across renders of the same tree: React's key, and the virtualiser's measurement key. */
    key: string;
    category: AssetCategory;
    /** Indent depth, 0 at a section's root. */
    level: number;
    /** What a range covers, or null for a row nothing can mark. */
    selectionKey: string | null;
    /** The folders enclosing this row, outermost first. */
    groupPath: readonly string[];
    /** The set whose tint this row carries, and whether it opens or closes the band. */
    band: { setId: string; first: boolean; last: boolean } | null;
} & (
    | {
        kind: "set";
        entry: T;
        /** Drawn inside another set: it does not move on its own, and carries no tint of its own. */
        nested: boolean;
        /** The parent set and the value this one hangs at, when it is drawn inside one. */
        parent?: { entry: T; cell: RowCellOf<T> };
    }
    | {
        kind: "setValue";
        entry: T;
        cell: RowCellOf<T>;
        /** The single file answering this value, or null when the value is a hole. */
        assetId: string | null;
    }
    | { kind: "group"; group: AssetGroup }
    | { kind: "asset"; asset: Asset }
);

/**
 * One section's rows, in the order `AssetsListView` draws them.
 *
 * Sets first at every level, then folders, then the loose files - which is what makes a range
 * between two rows cover exactly what sits between them on screen.
 */
export function listViewCategoryRows<T extends AssetSetRows>(
    category: AssetCategory,
    {
        assets,
        groups,
        rootAssetSets,
        assetSets,
        memberAssetIds,
        expandedGroups,
        expandedAssetSets,
        isNarrowed,
    }: ListViewRowOrderInput<T>,
): ListViewRow<T>[] {
    const rows: ListViewRow<T>[] = [];
    const setsById = new Map(assetSets[category].map(entry => [entry.set.id, entry]));

    /**
     * `keyPath` is the walk that reached this set, not the set's id: the same declaration can hang
     * under two values of two different parents, and two rows sharing a React key is the one thing
     * a windowed list cannot survive.
     */
    const pushSet = (
        entry: T,
        level: number,
        groupPath: readonly string[],
        bandSetId: string | null,
        parent: { entry: T; cell: RowCellOf<T> } | undefined,
        keyPath: string,
    ): void => {
        const nested = parent !== undefined;
        // A top-level set opens its own band; a nested one continues the band it is drawn inside.
        const band = bandSetId ?? (nested ? null : entry.set.id);
        const bandStart = rows.length;
        const selfPath = keyPath + "set:" + entry.set.id;
        rows.push({
            kind: "set",
            key: selfPath,
            category,
            level,
            selectionKey: null,
            groupPath,
            band: band ? { setId: band, first: !nested, last: false } : null,
            entry,
            nested,
            ...(parent ? { parent } : {}),
        });
        // Closed, a set hides its members as surely as a collapsed folder hides its files.
        if (!expandedAssetSets.has(entry.set.id)) {
            if (!nested) {
                closeBand(rows, bandStart);
            }
            return;
        }
        entry.contents.cells.forEach((cell, index) => {
            const cellPath = selfPath + "/" + index + "/";
            const child = cell.childSetIds.length === 1 ? setsById.get(cell.childSetIds[0]) : undefined;
            if (child) {
                pushSet(child, level + 1, groupPath, band, { entry, cell }, cellPath);
                return;
            }
            // A value answered by exactly one file is that file's ordinary row, marks included. A
            // value with no file, or with several, is drawn as the hole it is and carries no key:
            // there is no single row for a range to reach.
            const assetId = cell.assetIds.length === 1 ? cell.assetIds[0] : null;
            rows.push({
                kind: "setValue",
                key: cellPath + "value",
                category,
                level: level + 1,
                selectionKey: assetId ? assetSelectionKey(assetId, false) : null,
                groupPath,
                band: band ? { setId: band, first: false, last: false } : null,
                entry,
                cell,
                assetId,
            });
        });
        if (!nested) {
            closeBand(rows, bandStart);
        }
    };

    const pushLevel = (groupId: string | null, level: number, groupPath: readonly string[]): void => {
        for (const entry of assetSetsFiledIn(rootAssetSets[category], groupId)) {
            pushSet(entry, level, groupPath, null, undefined, "");
        }
        for (const group of groupsFiledIn(groups[category], groupId)) {
            rows.push({
                kind: "group",
                key: "group:" + group.id,
                category,
                level,
                selectionKey: assetSelectionKey(group.id, true),
                groupPath,
                band: null,
                group,
            });
            if (isNarrowed || expandedGroups.has(group.id)) {
                pushLevel(group.id, level + 1, [...groupPath, group.id]);
            }
        }
        for (const asset of assetsFiledIn(assets[category], groupId, memberAssetIds)) {
            rows.push({
                kind: "asset",
                key: "asset:" + asset.id,
                category,
                level,
                selectionKey: assetSelectionKey(asset.id, false),
                groupPath,
                band: null,
                asset,
            });
        }
    };

    pushLevel(null, 0, []);
    return rows;
}

/** Mark the last row a top-level set drew, so the tint ends where the set does. */
function closeBand<T extends AssetSetRows>(rows: ListViewRow<T>[], bandStart: number): void {
    const last = rows[rows.length - 1];
    if (last && last.band && rows.length > bandStart) {
        last.band = { ...last.band, last: true };
    }
}

/** One section of the grid, already reduced to the tiles it draws. See `AssetsIconView`. */
export interface IconViewSection {
    groups: readonly AssetGroup[];
    assets: readonly Asset[];
    /** The values of the set the grid has been walked into, empty anywhere else. */
    setCells: readonly AssetSetRowCell[];
}

/**
 * The grid's tiles, in the order `AssetsIconView` draws them.
 *
 * Takes the sections the grid built rather than rebuilding them: which tiles a section holds depends
 * on the folder walked into, the set stepped into and whether a search has flattened the grid, and
 * a second copy of those rules is a second answer to what is on screen.
 *
 * Set tiles come first in each section and are left out here, the same way the tree leaves out a
 * set's row.
 */
export function iconViewRowOrder(sections: readonly IconViewSection[]): string[] {
    const keys: string[] = [];

    for (const section of sections) {
        for (const cell of section.setCells) {
            // Inside a set: one tile per value it promises. A value answered by a sub-set is that
            // set's tile, and a value nothing answers is the hole; neither is selectable.
            if (cell.childSetIds.length === 1) {
                continue;
            }
            if (cell.assetIds.length === 1) {
                keys.push(assetSelectionKey(cell.assetIds[0], false));
            }
        }
        for (const group of section.groups) {
            keys.push(assetSelectionKey(group.id, true));
        }
        for (const asset of section.assets) {
            keys.push(assetSelectionKey(asset.id, false));
        }
    }

    return keys;
}
