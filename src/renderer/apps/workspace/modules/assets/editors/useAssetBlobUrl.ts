import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { Asset, AssetSource } from "@/lib/workspace/services/assets/types";
import type { AssetType } from "@/lib/workspace/services/assets/assetTypes";

/**
 * Fetch an asset's bytes and expose them as an object URL (revoked on unmount / asset change),
 * plus the raw bytes for consumers that decode themselves (waveforms, JSON text). Shared by the
 * simple preview editors - the image/audio editors predate it and manage their own fetch.
 */
export function useAssetBlobUrl<T extends AssetType>(
    asset: Asset<T, AssetSource> | undefined,
    mimeType?: string,
): { url: string | null; bytes: Uint8Array | null; loading: boolean; error: string | null } {
    const { context } = useWorkspace();
    const [state, setState] = useState<{ url: string | null; bytes: Uint8Array | null; loading: boolean; error: string | null }>({
        url: null,
        bytes: null,
        loading: true,
        error: null,
    });
    const urlRef = useRef<string | null>(null);

    useEffect(() => {
        let mounted = true;
        if (!context || !asset) {
            setState({ url: null, bytes: null, loading: false, error: null });
            return;
        }
        setState(previous => ({ ...previous, loading: true, error: null }));
        const assetsService = context.services.get<AssetsService>(Services.Assets);
        void assetsService
            .fetch(asset)
            .then(result => {
                if (!mounted) {
                    return;
                }
                if (!result.success) {
                    setState({ url: null, bytes: null, loading: false, error: String(result.error ?? "Failed to load asset") });
                    return;
                }
                const bytes = result.data.data as Uint8Array;
                const blob = new Blob([bytes as BlobPart], mimeType ? { type: mimeType } : undefined);
                const url = URL.createObjectURL(blob);
                if (urlRef.current) {
                    URL.revokeObjectURL(urlRef.current);
                }
                urlRef.current = url;
                setState({ url, bytes, loading: false, error: null });
            })
            .catch(error => {
                if (mounted) {
                    setState({ url: null, bytes: null, loading: false, error: String(error) });
                }
            });
        return () => {
            mounted = false;
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
        };
    }, [context, asset?.id, asset?.hash]);

    return state;
}
