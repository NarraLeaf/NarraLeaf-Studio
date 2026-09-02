import { useEffect, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { categoryOfAssetType, type AssetCategory } from "@/lib/workspace/services/assets/assetTypes";

/**
 * The sections whose metadata file is on disk and could not be read.
 *
 * The panel needs this because such a section looks exactly like an empty one and means the
 * opposite: the record is empty *because* the file could not be parsed, and the file still holds
 * every asset the author ever imported into it. Both views deliberately print nothing under an
 * empty section - so this is the one case where they have something to print.
 *
 * A set of categories rather than the shards themselves, because that is the granularity the panel
 * draws at: one section covers a category, and a category can be more than one shard (media is
 * audio and video), either of which may be the bad one.
 *
 * Filled once, while the library comes up, and replaced only by a re-read of the working tree -
 * which is why `groupsUpdated` is enough to stay current: `AssetsService.reloadFromDisk` builds a
 * fresh metadata manager and broadcasts that event for every category.
 */
export function useUnreadableAssetCategories(): ReadonlySet<AssetCategory> {
    const { context, isInitialized } = useWorkspace();
    const [categories, setCategories] = useState<ReadonlySet<AssetCategory>>(() => new Set());

    useEffect(() => {
        if (!context || !isInitialized) {
            return;
        }
        let assets: AssetsService;
        try {
            assets = context.services.get<AssetsService>(Services.Assets);
        } catch {
            // A workspace that came up without the library (recovery mode) marks nothing.
            return;
        }

        let alive = true;
        const publish = () => {
            if (!alive) {
                return;
            }
            const next = new Set<AssetCategory>();
            for (const type of assets.getUnreadableAssetShards().keys()) {
                next.add(categoryOfAssetType(type));
            }
            // Replaced whole only when it says something different, so a section that is fine does
            // not re-render on every folder change the library broadcasts.
            setCategories(previous => (
                previous.size === next.size && [...next].every(category => previous.has(category))
                    ? previous
                    : next
            ));
        };

        publish();
        const offGroups = assets.getEvents().on("groupsUpdated", publish);

        return () => {
            alive = false;
            offGroups();
        };
    }, [context, isInitialized]);

    return categories;
}
