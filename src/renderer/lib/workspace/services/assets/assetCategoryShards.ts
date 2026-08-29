/**
 * Reading a category's folder shard off disk.
 *
 * Groups and row order are sharded by {@link AssetCategory}: the sidebar's sections are categories,
 * and a folder under "Media" has to hold an mp3 next to an mp4. Four of the six categories name the
 * file they always named (`image`, `font`, `model`, `other`); `media` and `data` are files of their
 * own.
 *
 * Nothing here converts anything. It parses, because the file is JSON a Studio wrote and a human
 * can edit, and a record that says nothing about which category it belongs to is filed under the
 * shard it was read from - which is the only answer available and always the right one, since that
 * is where a writer would have put it.
 */

import { AssetCategory } from "./assetTypes";
import type { AssetGroup } from "./types";

/** A group record as it arrives from JSON: the category may be missing, and anything may be junk. */
type RawAssetGroupRecord = Partial<AssetGroup> & { id?: unknown };

/**
 * Read one group shard's records, filing anything that does not name its own category.
 *
 * `fallbackCategory` is the shard the records were read from. A record with no `id` is dropped
 * rather than repaired: it addresses nothing, so no asset's `groupId` can be pointing at it.
 */
export function normalizeAssetGroupRecords(
    raw: Readonly<Record<string, RawAssetGroupRecord>> | null | undefined,
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
        const group: AssetGroup = {
            id: record.id,
            name: typeof record.name === "string" ? record.name : record.id,
            category: record.category ?? fallbackCategory,
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
