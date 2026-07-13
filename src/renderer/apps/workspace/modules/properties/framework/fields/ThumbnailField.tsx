import { useState, useEffect, useRef, useCallback, memo } from "react";
import { ThumbnailFieldDefinition } from "../types";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { ImageCropper } from "@/apps/workspace/modules/assets/components/ImageCropper";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset } from "@/lib/workspace/services/assets/types";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { ServiceAssetsService } from "@/lib/workspace/services/core/ServiceAssetsService";

const secondaryGhostButtonClass =
    "px-3 py-1.5 rounded-md border border-primary/30 bg-primary/5 text-sm text-primary hover:bg-primary/15 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

type CropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type NormalizedCrop = {
    xRatio: number;
    yRatio: number;
    widthRatio: number;
    heightRatio: number;
};

// Persist last crop selection in memory for reuse
let lastCropSelection: NormalizedCrop | null = null;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clampDimension = (value: number, max: number) => Math.max(1, Math.min(max, value));

const rememberLastCrop = (selection: CropRect, sourceWidth: number, sourceHeight: number) => {
    if (sourceWidth <= 0 || sourceHeight <= 0) return;
    const widthRatio = clamp01(selection.width / sourceWidth);
    const heightRatio = clamp01(selection.height / sourceHeight);
    const xRatio = clamp01(selection.x / sourceWidth);
    const yRatio = clamp01(selection.y / sourceHeight);
    if (widthRatio === 0 || heightRatio === 0) return;
    lastCropSelection = { xRatio, yRatio, widthRatio, heightRatio };
};

const centeredSquareCrop = (width: number, height: number): CropRect => {
    const side = Math.min(width, height);
    const startX = (width - side) / 2;
    const startY = (height - side) / 2;
    return { x: startX, y: startY, width: side, height: side };
};

const getInitialCropForImage = (width: number, height: number): CropRect => {
    if (!lastCropSelection) {
        return centeredSquareCrop(width, height);
    }
    const { xRatio, yRatio, widthRatio, heightRatio } = lastCropSelection;
    const cropWidth = clampDimension(widthRatio * width, width);
    const cropHeight = clampDimension(heightRatio * height, height);
    const maxX = Math.max(0, width - cropWidth);
    const maxY = Math.max(0, height - cropHeight);
    const x = Math.min(maxX, Math.max(0, xRatio * width));
    const y = Math.min(maxY, Math.max(0, yRatio * height));
    return { x, y, width: cropWidth, height: cropHeight };
};

interface ThumbnailFieldProps<TData> {
    field: ThumbnailFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

/**
 * Renders a thumbnail selector with cropping functionality
 */
function ThumbnailFieldInner<TData>({ field, data, onSaving }: ThumbnailFieldProps<TData>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
    const [selectorOpen, setSelectorOpen] = useState(false);
    const [cropperOpen, setCropperOpen] = useState(false);
    const [cropperImageUrl, setCropperImageUrl] = useState<string | null>(null);
    const [initialCrop, setInitialCrop] = useState<CropRect | undefined>(undefined);
    const [croppingAsset, setCroppingAsset] = useState<Asset | null>(null);
    const [cropSourceSize, setCropSourceSize] = useState<{ width: number; height: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const anchorRef = useRef<HTMLButtonElement>(null);

    // Use refs to avoid stale closures and unnecessary effect triggers
    const dataRef = useRef(data);
    const fieldRef = useRef(field);
    dataRef.current = data;
    fieldRef.current = field;

    const assetsService =
        context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null;
    const serviceAssets =
        context && isInitialized ? context.services.get<ServiceAssetsService>(Services.ServiceAssets) : null;

    const thumbnailId = field.getThumbnailId(data);

    // Track the current object URL created by us (not external URLs)
    const urlStateRef = useRef<{ url: string; thumbnailId: string } | null>(null);
    
    // Track the last external URL to detect changes
    const lastExternalUrlRef = useRef<string | null>(null);

    // Load thumbnail URL - handle both external URLs and self-loaded URLs
    useEffect(() => {
        // If no thumbnailId, clear everything
        if (!thumbnailId) {
            if (urlStateRef.current) {
                URL.revokeObjectURL(urlStateRef.current.url);
                urlStateRef.current = null;
            }
            lastExternalUrlRef.current = null;
            setThumbnailUrl(null);
            return;
        }

        let cancelled = false;

        const loadThumb = async () => {
            try {
                // First try to get URL from field's getter (may be sync or async)
                const externalUrl = await Promise.resolve(fieldRef.current.getThumbnailUrl(dataRef.current));
                
                if (cancelled) return;
                
                if (externalUrl) {
                    // External URL is provided, use it directly
                    // Clean up any URL we created ourselves
                    if (urlStateRef.current) {
                        URL.revokeObjectURL(urlStateRef.current.url);
                        urlStateRef.current = null;
                    }
                    lastExternalUrlRef.current = externalUrl;
                    setThumbnailUrl(externalUrl);
                    return;
                }

                // No external URL, check if we already have a URL for this thumbnailId
                if (urlStateRef.current?.thumbnailId === thumbnailId) {
                    setThumbnailUrl(urlStateRef.current.url);
                    return;
                }

                // Wait for services to be ready
                if (!serviceAssets) {
                    return;
                }

                // Fallback to loading from service
                const result = await serviceAssets.readRaw(thumbnailId);
                if (!result.ok || cancelled) {
                    if (!cancelled) setThumbnailUrl(null);
                    return;
                }
                // Clean up previous URL before creating new one
                if (urlStateRef.current) {
                    URL.revokeObjectURL(urlStateRef.current.url);
                }
                const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(result.data)]));
                if (!cancelled) {
                    urlStateRef.current = { url: objectUrl, thumbnailId };
                    lastExternalUrlRef.current = null;
                    setThumbnailUrl(objectUrl);
                } else {
                    // If cancelled after creation, clean up immediately
                    URL.revokeObjectURL(objectUrl);
                }
            } catch {
                if (!cancelled) setThumbnailUrl(null);
            }
        };

        void loadThumb();
        return () => {
            cancelled = true;
        };
    }, [serviceAssets, thumbnailId, data]);

    // Cleanup on unmount only
    useEffect(() => {
        return () => {
            if (urlStateRef.current) {
                URL.revokeObjectURL(urlStateRef.current.url);
                urlStateRef.current = null;
            }
        };
    }, []);

    const handleSelectThumbnail = useCallback(
        async (assets: Asset[]) => {
            const selected = assets[0];
            if (!selected || !assetsService) {
                setError(t("properties.thumbnail.error.workspaceNotReady"));
                return;
            }

            if (selected.type !== AssetType.Image) {
                setError(t("properties.thumbnail.error.selectImage"));
                return;
            }

            const result = await assetsService.fetch<AssetType.Image>(selected as Asset<AssetType.Image>);
            if (!result.success) {
                setError(result.error || t("properties.thumbnail.error.loadAsset"));
                return;
            }

            const buffer = new Uint8Array(result.data.data);
            const blob = new Blob([buffer]);
            const nextUrl = URL.createObjectURL(blob);

            // Revoke old cropper URL
            if (cropperImageUrl) {
                URL.revokeObjectURL(cropperImageUrl);
            }

            setCropperImageUrl(nextUrl);
            setCroppingAsset(selected);
            setError(null);

            const { width, height } = result.data.metadata;
            const initial = getInitialCropForImage(width, height);
            setInitialCrop(initial);
            setCropSourceSize({ width, height });
            setCropperOpen(true);
        },
        [assetsService, cropperImageUrl, t]
    );

    const handleClearThumbnail = useCallback(async () => {
        const currentId = fieldRef.current.getThumbnailId(dataRef.current);
        if (!currentId) {
            await fieldRef.current.setThumbnail(dataRef.current, null);
            return;
        }

        setIsSaving(true);
        onSaving(true);
        try {
            await fieldRef.current.setThumbnail(dataRef.current, null);
            if (thumbnailUrl) {
                URL.revokeObjectURL(thumbnailUrl);
                setThumbnailUrl(null);
            }
            if (serviceAssets) {
                const result = await serviceAssets.deleteFile(currentId);
                if (!result.ok) {
                    setError(result.error?.message || t("properties.thumbnail.error.deleteFailed"));
                }
            }
        } finally {
            setIsSaving(false);
            onSaving(false);
        }
    }, [onSaving, serviceAssets, thumbnailUrl, t]);

    const cropImage = useCallback(async (imageUrl: string, selection: CropRect): Promise<Blob> => {
        const { x, y, width, height } = selection;
        const loadImage = () =>
            new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error("Failed to load image for cropping"));
                img.src = imageUrl;
            });

        const img = await loadImage();
        const canvas = document.createElement("canvas");
        const targetWidth = Math.max(1, Math.round(width));
        const targetHeight = Math.max(1, Math.round(height));
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context unavailable");
        ctx.drawImage(img, x, y, width, height, 0, 0, targetWidth, targetHeight);

        return new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error("Failed to generate thumbnail"));
            }, "image/png");
        });
    }, []);

    const resetCropper = useCallback(() => {
        setCropperOpen(false);
        setCroppingAsset(null);
        setInitialCrop(undefined);
        setCropSourceSize(null);
        if (cropperImageUrl) {
            URL.revokeObjectURL(cropperImageUrl);
        }
        setCropperImageUrl(null);
    }, [cropperImageUrl]);

    const handleCropConfirm = useCallback(
        async (selection: CropRect) => {
            if (!serviceAssets || !croppingAsset || !cropperImageUrl) {
                setError(t("properties.thumbnail.error.workspaceNotReady"));
                return;
            }

            setIsSaving(true);
            onSaving(true);
            try {
                if (cropSourceSize) {
                    rememberLastCrop(selection, cropSourceSize.width, cropSourceSize.height);
                }
                const blob = await cropImage(cropperImageUrl, selection);
                const arrayBuffer = await blob.arrayBuffer();
                const writeResult = await serviceAssets.writeFile(new Uint8Array(arrayBuffer));
                if (!writeResult.ok) {
                    setError(writeResult.error?.message || t("properties.thumbnail.error.saveFailed"));
                    return;
                }
                const newId = writeResult.data;
                await fieldRef.current.setThumbnail(dataRef.current, newId);
                resetCropper();
            } catch (err) {
                setError(err instanceof Error ? err.message : t("properties.thumbnail.error.unknown"));
            } finally {
                setIsSaving(false);
                onSaving(false);
            }
        },
        [serviceAssets, croppingAsset, cropperImageUrl, cropSourceSize, cropImage, onSaving, resetCropper, t]
    );

    const effectiveAnchorRef = field.anchorRef || anchorRef;

    return (
        <div className={field.className}>
            {field.label && (
                <label className="block text-xs font-medium text-fg-muted mb-1">
                    {field.label}
                </label>
            )}
            <div className="bg-surface-raised border border-edge rounded-md p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-fg">{t("properties.preview")}</span>
                    <div className="flex items-center gap-2">
                        {thumbnailId && (
                            <button
                                className="text-xs text-red-400 hover:text-red-300"
                                onClick={handleClearThumbnail}
                                disabled={isSaving}
                            >
                                {t("common.clear")}
                            </button>
                        )}
                        <button
                            ref={anchorRef}
                            className={secondaryGhostButtonClass}
                            onClick={() => setSelectorOpen(true)}
                            disabled={isSaving}
                        >
                            {t("properties.select")}
                        </button>
                    </div>
                </div>
                <div className="relative w-full aspect-square rounded-md border border-edge bg-surface text-xs text-fg-muted overflow-hidden">
                    {thumbnailUrl ? (
                        <img
                            src={thumbnailUrl}
                            alt={t("properties.thumbnail.alt")}
                            className="absolute inset-0 w-full h-full object-cover"
                        />
                    ) : thumbnailId ? (
                        <div className="absolute inset-0 flex items-center justify-center text-fg-muted" />
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center space-y-1">
                            <div>{t("properties.thumbnail.empty")}</div>
                            <div className="text-2xs text-fg-subtle">{t("properties.thumbnail.emptyHint")}</div>
                        </div>
                    )}
                </div>
                {error && <div className="text-xs text-red-400">{error}</div>}
            </div>

            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Image}
                selectedIds={thumbnailId ? [thumbnailId] : []}
                onClose={() => setSelectorOpen(false)}
                onConfirm={(assets) => {
                    setSelectorOpen(false);
                    void handleSelectThumbnail(assets);
                }}
                anchorRef={effectiveAnchorRef as any}
                title={t("properties.thumbnail.selectTitle")}
                multiple={false}
            />
            <ImageCropper
                visible={cropperOpen}
                imageUrl={cropperImageUrl || ""}
                initialSelection={initialCrop}
                aspectRatio={field.aspectRatio ?? 1}
                anchorRef={effectiveAnchorRef as any}
                title={t("properties.thumbnail.cropTitle")}
                onClose={resetCropper}
                onConfirm={handleCropConfirm}
                className={isSaving ? "pointer-events-none opacity-90" : ""}
            />
        </div>
    );
}

export const ThumbnailField = memo(ThumbnailFieldInner) as typeof ThumbnailFieldInner;
