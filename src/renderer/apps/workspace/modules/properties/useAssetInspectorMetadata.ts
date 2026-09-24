import { useEffect, useRef, useState } from "react";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetType, type AssetData } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";

/**
 * Which file a piece of loaded metadata describes: the record and the bytes it points at.
 *
 * Everything the inspector's info rows print - duration, sample rate, dimensions, size - is read off
 * the file, so it goes stale exactly when one of these two changes and at no other time. A rename, a
 * retag or an extras patch (an audio marker) rewrites the record around the same bytes.
 */
export function assetFileKey(asset: Pick<Asset, "id" | "hash">): string {
    return `${asset.id}\u0000${asset.hash}`;
}

/**
 * Everything a read of this asset depends on: {@link assetFileKey}, plus a model bundle's entry
 * override.
 *
 * A bundle's `data` is not its bytes but the listing `ModelService` resolves, and the entry in it -
 * with the format guessed from that entry - is the author's override whenever that still names a
 * file in the bundle. So that one extras patch changes what a read returns without touching the
 * files, and the card would keep the entry from before the author picked another.
 */
export function assetReadKey(asset: Pick<Asset, "id" | "hash" | "type" | "extras">): string {
    const file = assetFileKey(asset);
    return asset.type === AssetType.Model ? `${file}\u0000${asset.extras?.modelEntry ?? ""}` : file;
}

type LoadedMetadata = {
    fileKey: string;
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
 *
 * A change to what the read depends on but not to the file - a bundle's entry override - reads again
 * without going through null: the card keeps its rows, and the entry select the author has just
 * used stays open, until the new entry arrives.
 */
export function useAssetInspectorMetadata(
    asset: Asset | null,
    assets: Pick<AssetsService, "fetch"> | null,
): AssetData<any> | null {
    const [loaded, setLoaded] = useState<LoadedMetadata | null>(null);
    const fileKey = asset ? assetFileKey(asset) : null;
    const readKey = asset ? assetReadKey(asset) : null;
    // The read takes the record as it is when the key changes; a record edit in between changes
    // nothing it reads.
    const assetRef = useRef(asset);
    assetRef.current = asset;

    useEffect(() => {
        const current = assetRef.current;
        if (!readKey || !current || !assets) {
            return;
        }

        const key = assetFileKey(current);
        let cancelled = false;
        const load = async () => {
            try {
                const result = await assets.fetch(current);
                if (cancelled) {
                    return;
                }
                if (!result.success) {
                    // What is held may answer the previous override; no rows beat a wrong entry.
                    setLoaded(null);
                    return;
                }
                const { data, metadata } = result.data as AssetData<any>;
                // Only the metadata: holding the file's bytes here would keep a whole clip in memory
                // for as long as it is selected. A bundle's `data` is the exception because it is
                // not bytes - it is the listing the card reads its entry and format from.
                const value = current.type === AssetType.Model ? { data, metadata } : { metadata };
                setLoaded({ fileKey: key, value: value as AssetData<any> });
            } catch (err) {
                console.error("Failed to load asset metadata:", err);
            }
        };
        void load();

        return () => {
            cancelled = true;
        };
    }, [readKey, assets]);

    return loaded && loaded.fileKey === fileKey ? loaded.value : null;
}
