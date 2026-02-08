import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";

interface AssetObjectUrlState {
    url: string | null;
    metadata: AssetData<AssetType.Image> | null;
    loading: boolean;
    error: string | null;
}

export function useAssetObjectUrl(assetId?: string | null) {
    const { context } = useWorkspace();
    const assetsService = context ? context.services.get<AssetsService>(Services.Assets) : null;
    const [state, setState] = useState<AssetObjectUrlState>({
        url: null,
        metadata: null,
        loading: false,
        error: null,
    });
    const urlRef = useRef<string | null>(null);

    useEffect(() => {
        if (!assetId) {
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
            setState({
                url: null,
                metadata: null,
                loading: false,
                error: null,
            });
            return;
        }

        if (!assetsService) {
            setState({
                url: null,
                metadata: null,
                loading: false,
                error: "Assets service not ready",
            });
            return;
        }

        const asset = assetsService.getAssets()[AssetType.Image]?.[assetId];
        if (!asset) {
            setState({
                url: null,
                metadata: null,
                loading: false,
                error: "Image asset not found",
            });
            return;
        }

        let cancelled = false;
        setState(prev => ({
            ...prev,
            loading: true,
            error: null,
        }));

        (async () => {
            const result = await assetsService.fetch(asset);
            if (cancelled) {
                return;
            }
            if (!result.success || !result.data) {
                setState({
                    url: null,
                    metadata: null,
                    loading: false,
                    error: result.error ?? "Failed to load image",
                });
                return;
            }

            const blob = new Blob([new Uint8Array(result.data.data)]);
            const nextUrl = URL.createObjectURL(blob);
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
            }
            urlRef.current = nextUrl;
            setState({
                url: nextUrl,
                metadata: result.data,
                loading: false,
                error: null,
            });
        })();

        return () => {
            cancelled = true;
        };
    }, [assetId, assetsService]);

    useEffect(() => {
        return () => {
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
        };
    }, []);

    return state;
}
