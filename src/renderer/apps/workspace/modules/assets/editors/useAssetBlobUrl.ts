import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { Asset, AssetSource } from "@/lib/workspace/services/assets/types";
import type { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { AssetReadFailure } from "./useAssetReadNotice";

type AssetBlobState = { url: string | null; bytes: Uint8Array | null; loading: boolean; failure: AssetReadFailure | null };

/**
 * Fetch an asset's bytes and expose them as an object URL (revoked on unmount / asset change),
 * plus the raw bytes for consumers that decode themselves (waveforms, JSON text). Shared by the
 * simple preview editors - the image/audio editors predate it and manage their own fetch.
 *
 * A read that fails answers what it failed with - the read's code - and not its message, which is
 * English and names the asset's storage path. `useAssetReadNotice` words it.
 */
export function useAssetBlobUrl<T extends AssetType>(
    asset: Asset<T, AssetSource> | undefined,
    mimeType?: string,
): AssetBlobState {
    const { context } = useWorkspace();
    const [state, setState] = useState<AssetBlobState>({
        url: null,
        bytes: null,
        loading: true,
        failure: null,
    });
    const urlRef = useRef<string | null>(null);

    useEffect(() => {
        let mounted = true;
        if (!context || !asset) {
            setState({ url: null, bytes: null, loading: false, failure: null });
            return;
        }
        setState(previous => ({ ...previous, loading: true, failure: null }));
        const assetsService = context.services.get<AssetsService>(Services.Assets);
        void assetsService
            .fetch(asset)
            .then(result => {
                if (!mounted) {
                    return;
                }
                if (!result.success) {
                    console.warn(`[assets] could not read ${asset.id}: ${result.error ?? ""}`);
                    setState({ url: null, bytes: null, loading: false, failure: { code: result.code } });
                    return;
                }
                const bytes = result.data.data as Uint8Array;
                const blob = new Blob([bytes as BlobPart], mimeType ? { type: mimeType } : undefined);
                const url = URL.createObjectURL(blob);
                if (urlRef.current) {
                    URL.revokeObjectURL(urlRef.current);
                }
                urlRef.current = url;
                setState({ url, bytes, loading: false, failure: null });
            })
            .catch(error => {
                if (mounted) {
                    console.warn(`[assets] could not read ${asset.id}`, error);
                    setState({ url: null, bytes: null, loading: false, failure: {} });
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
