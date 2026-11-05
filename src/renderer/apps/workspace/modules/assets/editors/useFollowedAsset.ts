import { useEffect, useState } from "react";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { Asset, AssetSource } from "@/lib/workspace/services/assets/types";
import type { AssetType } from "@/lib/workspace/services/assets/assetTypes";

/**
 * The asset a preview tab shows, as the library holds it now.
 *
 * A tab's payload is the record it was opened with. Replacing the asset's bytes - Replace File…, a
 * conversion, a PSD refresh, or the undo of any of them - keeps the id and announces `updated` with a
 * new `hash`, and sometimes a new extension and name; nothing rewrites the payload. A preview keyed on
 * the payload kept drawing the old picture until the tab was closed, while the inspector beside it
 * already showed the new file. Key a preview's read on this record's `id` and `hash`.
 */
export function useFollowedAsset<T extends AssetType>(
    asset: Asset<T, AssetSource> | undefined,
): Asset<T, AssetSource> | undefined {
    const { context } = useWorkspace();
    const [followed, setFollowed] = useState(asset);
    const [opened, setOpened] = useState(asset);
    if (opened !== asset) {
        // A new payload: the tab now shows another record, or the same one handed over afresh.
        setOpened(asset);
        setFollowed(asset);
    }

    const assetId = asset?.id;
    useEffect(() => {
        if (!context || !assetId) {
            return;
        }
        const assets = context.services.get<AssetsService>(Services.Assets);
        return assets.getEvents().on("updated", updated => {
            if (updated.id === assetId) {
                setFollowed({ ...updated } as Asset<T, AssetSource>);
            }
        });
    }, [context, assetId]);

    return followed;
}
