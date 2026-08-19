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

export interface ListViewRowOrderInput {
    /** Section ids the accordion is drawing open. A closed section draws no rows at all. */
    openCategories: readonly string[];
    /** The library as narrowed by the search box and the filters: what the tree is listing. */
    assets: Record<AssetCategory, Asset[]>;
    groups: Record<AssetCategory, AssetGroup[]>;
    /** Sets that hang under nothing, which is what a section and a folder list. */
    rootAssetSets: Record<AssetCategory, AssetSetRows[]>;
    /** Every set of the section, so an open one can find the sets hanging under its values. */
    assetSets: Record<AssetCategory, AssetSetRows[]>;
    memberAssetIds: ReadonlySet<string>;
    expandedGroups: ReadonlySet<string>;
    expandedAssetSets: ReadonlySet<string>;
    /** While a search or a filter narrows the library every surviving folder is drawn open. */
    isNarrowed: boolean;
}

/**
 * The tree's rows, in the order `AssetsListView` draws them.
 *
 * Sets first at every level, then folders, then the loose files - the order the view lays out, so
 * that a range between two rows covers exactly what sits between them on screen.
 */
export function listViewRowOrder({
    openCategories,
    assets,
    groups,
    rootAssetSets,
    assetSets,
    memberAssetIds,
    expandedGroups,
    expandedAssetSets,
    isNarrowed,
}: ListViewRowOrderInput): string[] {
    const keys: string[] = [];

    for (const category of ASSET_CATEGORY_ORDER) {
        if (!openCategories.includes(category)) {
            continue;
        }
        const setsById = new Map(assetSets[category].map(entry => [entry.set.id, entry]));

        // A set's own row is not selectable, so it adds nothing here. Closed, it hides its members
        // as surely as a collapsed folder hides its files, and they stay out of every range.
        const pushSet = (entry: AssetSetRows): void => {
            if (!expandedAssetSets.has(entry.set.id)) {
                return;
            }
            for (const cell of entry.contents.cells) {
                const child = cell.childSetIds.length === 1 ? setsById.get(cell.childSetIds[0]) : undefined;
                if (child) {
                    pushSet(child);
                    continue;
                }
                // A value answered by exactly one file is that file's ordinary row, marks included.
                // A value with no file, or with several, is drawn as the hole it is and carries no
                // key: there is no single row for a range to reach.
                if (cell.assetIds.length === 1) {
                    keys.push(assetSelectionKey(cell.assetIds[0], false));
                }
            }
        };

        const pushLevel = (groupId: string | null): void => {
            for (const entry of assetSetsFiledIn(rootAssetSets[category], groupId)) {
                pushSet(entry);
            }
            for (const group of groupsFiledIn(groups[category], groupId)) {
                keys.push(assetSelectionKey(group.id, true));
                if (isNarrowed || expandedGroups.has(group.id)) {
                    pushLevel(group.id);
                }
            }
            for (const asset of assetsFiledIn(assets[category], groupId, memberAssetIds)) {
                keys.push(assetSelectionKey(asset.id, false));
            }
        };

        pushLevel(null);
    }

    return keys;
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
