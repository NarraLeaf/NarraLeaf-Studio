import { useEffect, useState } from "react";
import { resolveDevModeSavePreviewImageUrl } from "@/lib/ui-editor/runtime/devModeSavePreviewAssets";
import { resolveCharacterAvatarAssetUrl } from "@/lib/ui-editor/runtime/characterAvatarAssets";
import { resolveGameRuntimeAssetUrl } from "@/lib/ui-editor/runtime/gameRuntimeBridge";

type AssetObjectUrlState = {
    url: string | null;
    metadata: null;
    loading: boolean;
    error: string | null;
};

/**
 * `assetType` exists only to match the workspace hook's signature. The packaged game resolves every
 * asset through one id-keyed protocol handler (`nlgame://asset/<id>`), which serves whatever the
 * pack manifest says the bytes are - so the pool a Studio author picked from is not information the
 * runtime needs, or has.
 */
export function useAssetObjectUrl(assetId?: string | null, _assetType?: unknown): AssetObjectUrlState {
    const [state, setState] = useState<AssetObjectUrlState>({
        url: null,
        metadata: null,
        loading: false,
        error: null,
    });

    useEffect(() => {
        if (!assetId) {
            setState({ url: null, metadata: null, loading: false, error: null });
            return;
        }
        const previewUrl = resolveDevModeSavePreviewImageUrl(assetId);
        // Avatars first: the mounted compile already resolved them, so this is the swap that must
        // not cost a round trip.
        const runtimeUrl = previewUrl
            ?? resolveCharacterAvatarAssetUrl(assetId)
            ?? resolveGameRuntimeAssetUrl(assetId);
        setState({
            url: runtimeUrl,
            metadata: null,
            loading: false,
            error: runtimeUrl ? null : `Runtime asset not found: ${assetId}`,
        });
    }, [assetId]);

    return state;
}
