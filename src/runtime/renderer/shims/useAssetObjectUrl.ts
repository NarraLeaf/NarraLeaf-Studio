import { useEffect, useState } from "react";
import { resolveDevModeSavePreviewImageUrl } from "@/lib/ui-editor/runtime/devModeSavePreviewAssets";
import { resolveGameRuntimeAssetUrl } from "@/lib/ui-editor/runtime/gameRuntimeBridge";

type AssetObjectUrlState = {
    url: string | null;
    metadata: null;
    loading: boolean;
    error: string | null;
};

export function useAssetObjectUrl(assetId?: string | null): AssetObjectUrlState {
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
        const runtimeUrl = previewUrl ?? resolveGameRuntimeAssetUrl(assetId);
        setState({
            url: runtimeUrl,
            metadata: null,
            loading: false,
            error: runtimeUrl ? null : `Runtime asset not found: ${assetId}`,
        });
    }, [assetId]);

    return state;
}
