/**
 * Folding the per-type folder and row-order shards up into per-category ones.
 *
 * Groups and row order used to be sharded by {@link AssetType}; they are now sharded by
 * {@link AssetCategory}, because the sidebar's sections are categories and a folder under "Media"
 * has to hold an mp3 next to an mp4. Four of the six categories name the file they always named
 * (`image`, `font`, `model`, `other`); `media` and `data` are new files whose contents come from the
 * `audio`+`video` and `json`+`blueprint` shards.
 *
 * Three rules the merge obeys, each of which is a way this could silently destroy an author's
 * library if it got them wrong:
 *
 *  - **Ids do not change.** A group keeps its id, so every asset's `groupId` still resolves and no
 *    metadata shard is touched. Getting this wrong un-files every asset in the project.
 *  - **The old files stay.** Nothing is deleted. The merge reads them and writes a new file beside
 *    them; a Studio that predates this still finds its own shards where it left them.
 *  - **No de-duplication.** Two folders called "Chapter 1", one under audio and one under video, are
 *    two folders with two ids and stay two rows. They were never the same object and merging them
 *    would move assets between them.
 *
 * The merge runs once, on the read that finds the category shard absent, and only then.
 */

import { ASSET_CATEGORY_TYPES, AssetCategory, AssetType, categoryOfAssetType } from "./assetTypes";
import type { AssetOrderDocument } from "./assetOrder";
import type { AssetGroup, LegacyTypedAssetGroup } from "./types";

/**
 * The type-named shards a category's contents may still be sitting in.
 *
 * Empty for a category whose id is already one of its member types' ids — `image` reads
 * `assets.groups.image.json`, which is the same file it has always read, so there is nothing to
 * migrate and nothing to merge.
 */
export function legacyShardTypesFor(category: AssetCategory): AssetType[] {
    return ASSET_CATEGORY_TYPES[category].filter(type => String(type) !== String(category));
}

/**
 * Read one group shard's records, filing anything that predates the category layer.
 *
 * `fallbackCategory` is what a record with neither field is filed under — the shard it was read
 * from. A record that names a `type` is folded through {@link categoryOfAssetType}; one that already
 * names a `category` is taken at its word.
 */
export function normalizeAssetGroupRecords(
    raw: Readonly<Record<string, LegacyTypedAssetGroup>> | null | undefined,
    fallbackCategory: AssetCategory,
): Record<string, AssetGroup> {
    const out: Record<string, AssetGroup> = {};
    if (!raw || typeof raw !== "object") {
        return out;
    }

    for (const [id, record] of Object.entries(raw)) {
        if (!record || typeof record !== "object" || typeof record.id !== "string") {
            continue;
        }
        const category = record.category
            ?? (record.type ? categoryOfAssetType(record.type) : fallbackCategory);
        const group: AssetGroup = {
            id: record.id,
            name: typeof record.name === "string" ? record.name : record.id,
            category,
            createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
            updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
        };
        if (record.parentGroupId) {
            group.parentGroupId = record.parentGroupId;
        }
        out[id] = group;
    }

    return out;
}

/**
 * Merge the legacy shards of a category, in member-type order, into the record its own shard will
 * be created with.
 *
 * Ids collide only if the same group was written into two shards, which never happened; identical
 * *names* are left as the separate rows they are.
 */
export function mergeLegacyGroupShards(
    category: AssetCategory,
    shards: readonly { type: AssetType; records: Readonly<Record<string, LegacyTypedAssetGroup>> | null }[],
): Record<string, AssetGroup> {
    const merged: Record<string, AssetGroup> = {};
    for (const shard of shards) {
        Object.assign(merged, normalizeAssetGroupRecords(shard.records, category));
    }
    return merged;
}

/**
 * Merge legacy order documents, in member-type order.
 *
 * The result is a hint, never a filter (see {@link import("./assetOrder").reconcileAssetOrder}), so
 * an id that appears in neither list is appended rather than lost. Concatenating is therefore enough:
 * audio's rows keep their sequence, video's follow, and anything either list forgot lands at the end.
 */
export function mergeAssetOrderDocuments(documents: readonly AssetOrderDocument[]): AssetOrderDocument {
    const assetIds: string[] = [];
    const groupIds: string[] = [];
    const seenAssets = new Set<string>();
    const seenGroups = new Set<string>();

    for (const document of documents) {
        for (const id of document.assetIds) {
            if (!seenAssets.has(id)) {
                seenAssets.add(id);
                assetIds.push(id);
            }
        }
        for (const id of document.groupIds) {
            if (!seenGroups.has(id)) {
                seenGroups.add(id);
                groupIds.push(id);
            }
        }
    }

    return { assetIds, groupIds };
}
