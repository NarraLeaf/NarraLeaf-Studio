import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import { EditorComponentProps } from "../../types";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetData, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { ActionDefinition, useRegistry } from "../../../registry";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { useTranslation } from "@/lib/i18n";
import {
    ImagePixelPreview,
    type ImagePixelPreviewControls,
} from "@/apps/workspace/modules/assets/components/ImagePixelPreview";

interface ImagePreviewPayload {
    asset: Asset<AssetType.Image>;
}

function LoadingState() {
    const { t } = useTranslation();
    return (
        <div className="h-full flex items-center justify-center bg-surface">
            <div className="flex items-center gap-2 text-fg-muted">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>{t("assets.image.loading")}</span>
            </div>
        </div>
    );
}

function ErrorState({ error }: { error: string }) {
    const { t } = useTranslation();
    return (
        <div className="h-full flex items-center justify-center bg-surface p-4">
            <div className="flex items-start gap-2 text-red-400 bg-red-500/10 rounded-md p-4 max-w-md">
                <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div>
                    <p className="font-medium">{t("assets.image.loadError")}</p>
                    <p className="text-sm mt-1 text-red-300">{error}</p>
                </div>
            </div>
        </div>
    );
}

function PreviewToolbar({
    imageData,
    controls,
}: {
    imageData: AssetData<AssetType.Image>;
    controls: ImagePixelPreviewControls;
}) {
    const { t } = useTranslation();
    const size = controls.imageSize ?? imageData.metadata;

    return (
        <div className="flex items-center justify-between px-4 py-2 border-b border-edge bg-surface-raised">
            <div className="flex items-center gap-4">
                <span className="text-sm text-fg-muted">
                    {size.width} x {size.height}
                </span>
                <span className="text-sm text-fg-muted">
                    {imageData.metadata.format.toUpperCase()}
                </span>
                <span className="text-sm text-fg-muted">
                    {(imageData.metadata.size / 1024).toFixed(1)} KB
                </span>
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={controls.zoomOut}
                    className="p-1 rounded hover:bg-fill text-fg-muted hover:text-white transition-colors cursor-default"
                    title={t("assets.image.zoomOut")}
                >
                    <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-sm text-fg-muted min-w-16 text-center">
                    {controls.zoomLabel}
                </span>
                <button
                    onClick={controls.zoomIn}
                    className="p-1 rounded hover:bg-fill text-fg-muted hover:text-white transition-colors cursor-default"
                    title={t("assets.image.zoomIn")}
                >
                    <ZoomIn className="w-4 h-4" />
                </button>
                <button
                    onClick={controls.resetView}
                    className="p-1 rounded hover:bg-fill text-fg-muted hover:text-white transition-colors cursor-default ml-2"
                    title={t("assets.image.resetView")}
                >
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

/**
 * Image preview editor component
 * Displays image with zoom and pan controls
 */
export function ImagePreviewEditor({ tabId, payload }: EditorComponentProps<ImagePreviewPayload>) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { registerActionGroup, unregisterActionGroup } = useRegistry();
    const controlsRef = useRef<ImagePixelPreviewControls | null>(null);
    const imageUrl = useRef<string | null>(null);
    const asset = payload?.asset;
    const [state, setState] = useState<{
        imageData: AssetData<AssetType.Image> | null;
        loading: boolean;
        error: string | null;
        url: string | null;
    }>({
        imageData: null,
        loading: true,
        error: null,
        url: null,
    });

    const handleZoomIn = useCallback(() => controlsRef.current?.zoomIn(), []);
    const handleZoomOut = useCallback(() => controlsRef.current?.zoomOut(), []);
    const handleResetView = useCallback(() => controlsRef.current?.resetView(), []);

    useEffect(() => {
        const groupId = `${tabId}-image-preview-actions`;

        const focusWhen = (ctx: any) => ctx?.area === FocusArea.Editor && ctx?.targetId === tabId;
        const namespace = "narraleaf-studio:image-preview";

        const zoomInAction: ActionDefinition = {
            id: `${namespace}:${groupId}-zoom-in`,
            icon: <ZoomIn className="w-4 h-4" />,
            label: t("assets.image.zoomIn"),
            shortcut: "ctrl+=",
            onClick: handleZoomIn,
            order: 1,
            when: focusWhen,
        };

        const zoomOutAction: ActionDefinition = {
            id: `${namespace}:${groupId}-zoom-out`,
            icon: <ZoomOut className="w-4 h-4" />,
            label: t("assets.image.zoomOut"),
            shortcut: "ctrl+-",
            onClick: handleZoomOut,
            order: 2,
            when: focusWhen,
        };

        const resetViewAction: ActionDefinition = {
            id: `${namespace}:${groupId}-reset-view`,
            icon: <RefreshCw className="w-4 h-4" />,
            label: t("assets.image.resetView"),
            shortcut: "ctrl+0",
            onClick: handleResetView,
            order: 3,
            when: focusWhen,
        };

        registerActionGroup({
            id: groupId,
            label: t("assets.preview"),
            actions: [zoomOutAction, zoomInAction, resetViewAction],
        });

        return () => {
            unregisterActionGroup(groupId);
        };
    }, [handleResetView, handleZoomIn, handleZoomOut, registerActionGroup, tabId, unregisterActionGroup, t]);

    useEffect(() => {
        if (!context || !asset) return;

        let cancelled = false;

        const loadImage = async () => {
            setState(prev => ({ ...prev, loading: true, error: null }));

            try {
                const assetsService = context.services.get<AssetsService>(Services.Assets);
                const result = await assetsService.fetch(asset);

                if (cancelled) {
                    return;
                }

                if (!result.success) {
                    setState({
                        imageData: null,
                        loading: false,
                        error: result.error || t("assets.image.loadError"),
                        url: null,
                    });
                    return;
                }

                const blob = new Blob([new Uint8Array(result.data.data)]);
                if (imageUrl.current) {
                    URL.revokeObjectURL(imageUrl.current);
                }
                imageUrl.current = URL.createObjectURL(blob);
                setState({
                    imageData: result.data,
                    loading: false,
                    error: null,
                    url: imageUrl.current,
                });
            } catch (err) {
                if (cancelled) {
                    return;
                }
                console.error("Failed to load image:", err);
                setState({
                    imageData: null,
                    loading: false,
                    error: err instanceof Error ? err.message : String(err),
                    url: null,
                });
            }
        };

        loadImage();

        return () => {
            cancelled = true;
            if (imageUrl.current) {
                URL.revokeObjectURL(imageUrl.current);
                imageUrl.current = null;
            }
        };
    }, [context, asset]);

    if (state.loading) {
        return <LoadingState />;
    }

    if (state.error) {
        return <ErrorState error={state.error} />;
    }

    if (!state.imageData || !state.url) {
        return null;
    }

    const renderToolbar = (controls: ImagePixelPreviewControls): ReactNode => (
        <PreviewToolbar imageData={state.imageData!} controls={controls} />
    );

    return (
        <ImagePixelPreview
            src={state.url}
            alt={asset?.name}
            initialSize={{
                width: state.imageData.metadata.width,
                height: state.imageData.metadata.height,
            }}
            resetKey={asset?.id ?? state.url}
            controlsRef={controlsRef}
            renderToolbar={renderToolbar}
        />
    );
}
