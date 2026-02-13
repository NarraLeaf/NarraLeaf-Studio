import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { getInterface } from "@/lib/app/bridge";
import { WindowAppType } from "@shared/types/window";
import { join } from "@shared/utils/path";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetSource } from "@/lib/workspace/services/assets/types";

interface AssetObjectUrlState {
    url: string | null;
    metadata: AssetData<AssetType.Image> | null;
    loading: boolean;
    error: string | null;
}

type ImageAssetsMetadataFile = Record<string, Asset<AssetType.Image, any>>;

const imageAssetsMetadataCache = new Map<string, ImageAssetsMetadataFile>();

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

        // Fallback for environments without Workspace context (e.g. Dev Mode).
        // In Dev Mode we still want to resolve image assets by reading project metadata + asset bytes.
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
                    const url = await resolveImageAssetUrlWithoutWorkspace(assetId);
                    if (cancelled) {
                        return;
                    }
                    if (!url) {
                        setState({
                            url: null,
                            metadata: null,
                            loading: false,
                            error: "Image asset not found",
                        });
                        return;
                    }

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

async function resolveImageAssetUrlWithoutWorkspace(assetId: string): Promise<string | null> {
    const iface = getInterface();
    const projectPath = await tryGetProjectPathFromWindowProps();
    if (!projectPath) {
        return null;
    }

    const metadata = await readImageAssetsMetadata(projectPath);
    const asset = metadata[assetId];
    if (!asset) {
        return null;
    }

    // Remote assets can be used directly (subject to CORS).
    if (asset.source === AssetSource.Remote) {
        const url = (asset as any)?.meta?.url;
        return typeof url === "string" && url.trim() ? url : null;
    }

    // Local assets are stored under assets/content/{shard...} with filename = assetId (no extension).
    const [a, b, rest] = splitIdForStorage(assetId);
    const assetPath = join(projectPath, "assets", "content", a, b, rest);

    const request = await iface.fs.requestReadRaw(assetPath);
    if (!request.success || !request.data?.ok) {
        return null;
    }

    const hash = request.data.data;
    const response = await fetch(`app://fs/${hash}`);
    if (!response.ok) {
        return null;
    }
    const buffer = await response.arrayBuffer();
    const blobUrl = URL.createObjectURL(new Blob([buffer]));
    return blobUrl;
}

async function tryGetProjectPathFromWindowProps(): Promise<string | null> {
    const iface = getInterface();

    // Prefer Dev Mode props if available.
    try {
        const devModeProps = await iface.getWindowProps<WindowAppType.DevMode>();
        if (devModeProps.success && devModeProps.data?.projectPath) {
            return devModeProps.data.projectPath;
        }
    } catch {
        // ignore
    }

    // Fallback to Workspace window props if present.
    try {
        const workspaceProps = await iface.getWindowProps<WindowAppType.Workspace>();
        if (workspaceProps.success && workspaceProps.data?.projectPath) {
            return workspaceProps.data.projectPath;
        }
    } catch {
        // ignore
    }

    return null;
}

async function readImageAssetsMetadata(projectPath: string): Promise<ImageAssetsMetadataFile> {
    const cached = imageAssetsMetadataCache.get(projectPath);
    if (cached) {
        return cached;
    }

    const iface = getInterface();
    const metadataPath = join(projectPath, "assets", "assets.metadata.image.json");
    const request = await iface.fs.requestRead(metadataPath, "utf-8");
    if (!request.success || !request.data?.ok) {
        const empty: ImageAssetsMetadataFile = {};
        imageAssetsMetadataCache.set(projectPath, empty);
        return empty;
    }

    const hash = request.data.data;
    const response = await fetch(`app://fs/${hash}`);
    if (!response.ok) {
        const empty: ImageAssetsMetadataFile = {};
        imageAssetsMetadataCache.set(projectPath, empty);
        return empty;
    }

    const text = await response.text();
    let parsed: ImageAssetsMetadataFile = {};
    try {
        parsed = (JSON.parse(text) ?? {}) as ImageAssetsMetadataFile;
    } catch {
        parsed = {};
    }
    imageAssetsMetadataCache.set(projectPath, parsed);
    return parsed;
}

function splitIdForStorage(id: string): [string, string, string] {
    // Keep consistent with ProjectNameConvention.splitId (not exported).
    const cleanId = id.replace(/-/g, "");
    if (cleanId.length < 4) {
        const padded = cleanId.padEnd(4, "0");
        return [padded.slice(0, 2), padded.slice(2, 4), id];
    }
    const charsA = cleanId.slice(0, 2);
    const charsB = cleanId.slice(2, 4);
    const rest = cleanId.slice(4);
    return [charsA, charsB, rest || id];
}
