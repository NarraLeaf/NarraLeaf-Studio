import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { getInterface } from "@/lib/app/bridge";
import { resolveDevModeSavePreviewImageUrl } from "@/lib/ui-editor/runtime/devModeSavePreviewAssets";
import {
    isCharacterAvatarAssetId,
    resolveCharacterAvatarAssetUrl,
} from "@/lib/ui-editor/runtime/characterAvatarAssets";
import { resolveGameRuntimeAssetUrl } from "@/lib/ui-editor/runtime/gameRuntimeBridge";

interface AssetObjectUrlState {
    url: string | null;
    metadata: AssetData<AssetType.Image> | null;
    loading: boolean;
    error: string | null;
}

export function useAssetObjectUrl(assetId?: string | null) {
    let workspaceValue: ReturnType<typeof useWorkspace> | null = null;
    let context: WorkspaceContext | null = null;
    try {
        workspaceValue = useWorkspace();
        context = workspaceValue.context;
    } catch {
        workspaceValue = null;
        context = null;
    }
    const assetsService = context ? context.services.get<AssetsService>(Services.Assets) : null;
    const [state, setState] = useState<AssetObjectUrlState>({
        url: null,
        metadata: null,
        loading: false,
        error: null,
    });
    const urlRef = useRef<string | null>(null);
    /**
     * Bumped when this asset's bytes are replaced. Everything downstream of this hook — story rows,
     * character variants, widget fills — addresses the asset by id, and the id survives a
     * replacement, so without a second key the effect below would never re-run and every one of them
     * would keep the pre-replacement picture until the tab was remounted.
     */
    const [contentGeneration, setContentGeneration] = useState(0);

    useEffect(() => {
        if (!assetsService || !assetId) {
            return;
        }
        return assetsService.getEvents().on("updated", asset => {
            if (asset.id === assetId) {
                setContentGeneration(generation => generation + 1);
            }
        });
    }, [assetsService, assetId]);

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

        const runtimePreviewUrl = resolveDevModeSavePreviewImageUrl(assetId);
        if (runtimePreviewUrl) {
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
            setState({
                url: runtimePreviewUrl,
                metadata: null,
                loading: false,
                error: null,
            });
            return;
        }

        // A dialog avatar the mounted compile already resolved. This has to come before every
        // other arm: it is the swap that must not flash, and in Dev Mode the ordinary arm costs
        // two IPC hops. A synthetic (baked) avatar id stops here either way - it has no record in
        // the asset library, so falling through would spend that round trip only to be told so.
        const avatarUrl = resolveCharacterAvatarAssetUrl(assetId);
        if (avatarUrl || isCharacterAvatarAssetId(assetId)) {
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
            setState({
                url: avatarUrl,
                metadata: null,
                loading: false,
                error: avatarUrl ? null : `Avatar is not available in this session: ${assetId}`,
            });
            return;
        }

        const gameRuntimeUrl = resolveGameRuntimeAssetUrl(assetId);
        if (gameRuntimeUrl) {
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
            setState({
                url: gameRuntimeUrl,
                metadata: null,
                loading: false,
                error: null,
            });
            return;
        }

        // Dev Mode without workspace context should still resolve assets through IPC.
        if (!assetsService) {
            if (workspaceValue) {
                setState({
                    url: null,
                    metadata: null,
                    loading: false,
                    error: "Assets service not ready",
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
                try {
                    const result = await getInterface().devMode.resolveImageAssetUrl(assetId);
                    if (cancelled) {
                        return;
                    }
                    if (!result.success || !result.data?.url) {
                        setState({
                            url: null,
                            metadata: null,
                            loading: false,
                            error: result.error ?? "Image asset not found",
                        });
                        return;
                    }

                    const url = result.data.url;
                    if (urlRef.current) {
                        URL.revokeObjectURL(urlRef.current);
                        urlRef.current = null;
                    }
                    urlRef.current = url;
                    setState({
                        url,
                        metadata: null,
                        loading: false,
                        error: null,
                    });
                } catch (err) {
                    if (cancelled) {
                        return;
                    }
                    setState({
                        url: null,
                        metadata: null,
                        loading: false,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            })();

            return () => {
                cancelled = true;
            };
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
    }, [assetId, assetsService, contentGeneration]);

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
