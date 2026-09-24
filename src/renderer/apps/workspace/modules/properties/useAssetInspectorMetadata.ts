import { useEffect, useRef, useState } from "react";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { AssetData } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";

/**
 * Which file a piece of loaded metadata describes: the record and the bytes it points at.
 *
 * Everything the inspector's info rows print - duration, sample rate, dimensions, size - is read off
 * the file, so it goes stale exactly when one of these two changes and at no other time. A rename, a
 * retag or an extras patch (an audio marker) rewrites the record around the same bytes.
 *
 * That holds for `metadata` only. A model bundle's `data` - its resolved entry - does follow an extras
 * patch, so keying `data` on this would show the entry from before the author's override.
 */
export function assetFileKey(asset: Pick<Asset, "id" | "hash">): string {
    return `${asset.id}\u0000${asset.hash}`;
}

type LoadedMetadata = {
    key: string;
    value: AssetData<any>;
};

/**
 * The metadata of the file the inspected asset points at, or null while it is loading.
 *
 * The result is held together with the {@link assetFileKey} it was read for and handed out only while
 * that still matches, rather than being cleared whenever the subject is published again. It used to
 * be cleared: every record edit republishes the asset selection (`UIService` does that so the panel
 * redraws an in-place mutation), the panel took each publication as a new subject and dropped its
 * metadata, and the reload - keyed on id and hash, neither of which a record edit touches - never
 * ran. So setting an in point on an audio clip left the info card with nothing but its hash until
 * the asset was selected afresh.
 *
 * Holding the key also answers the two cases the clearing was for: a different asset, or new bytes
 * under the same id, read as null until their own metadata arrives, and a slow read for the previous
 * subject cannot land on the next one.
 */
export function useAssetInspectorMetadata(
    asset: Asset | null,
    assets: Pick<AssetsService, "fetch"> | null,
): AssetData<any> | null {
    const [loaded, setLoaded] = useState<LoadedMetadata | null>(null);
    const key = asset ? assetFileKey(asset) : null;
    // The read takes the record as it is when the key changes; a record edit in between changes
    // nothing it reads.
    const assetRef = useRef(asset);
    assetRef.current = asset;

    useEffect(() => {
        const current = assetRef.current;
        if (!key || !current || !assets) {
            return;
        }

        let cancelled = false;
        const load = async () => {
            try {
                const result = await assets.fetch(current);
                if (!cancelled && result.success) {
                    // Only the metadata: holding the file's bytes here would keep a whole clip in
                    // memory for as long as it is selected.
                    const { metadata } = result.data as AssetData<any>;
                    setLoaded({ key, value: { metadata } as AssetData<any> });
                }
            } catch (err) {
                console.error("Failed to load asset metadata:", err);
            }
        };
        void load();

        return () => {
            cancelled = true;
        };
    }, [key, assets]);

    return loaded && loaded.key === key ? loaded.value : null;
}
