import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { AlertCircle, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import { EditorComponentProps } from "../../types";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetData, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
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

/**
 * The id the Preview group is registered under - fixed, and in Studio's namespace, so that
 * `components/ui/freezeActionPolicy` can name it.
 *
 * Zoom and Reset view move the viewport and write nothing at all, but a frozen workspace turns off
 * every top-bar group its exemption table does not name, and that table matches ids exactly. The
 * old id was built from the tab (`tab-7-image-preview-actions`), which is not a name anything can
 * hold, so on a frozen project the Preview menu and its palette entries greyed out and the author
 * could not zoom in on the very revision they had opened to look at.
 *
 * Kept distinct from the editor module's own `narraleaf-studio:image-preview`: two registries, two
 * ids, so neither can be mistaken for the other.
 */
const IMAGE_PREVIEW_GROUP_ID = "narraleaf-studio:image-preview-actions";

/**
 * Every mounted image preview, by tab id, with the view controls it exposes.
 *
 * One id means one registration for the whole workspace, so the group cannot belong to a single
 * tab: kept-alive tabs stay mounted and a split can show two previews at once. Each command
 * therefore dispatches to whichever preview currently holds focus, and the last preview to unmount
 * takes the group away.
 */
const mountedPreviews = new Map<string, MutableRefObject<ImagePixelPreviewControls | null>>();

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
            <div className="flex items-start gap-2 text-danger bg-danger/10 rounded-md p-4 max-w-md">
                <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div>
                    <p className="font-medium">{t("assets.image.loadError")}</p>
                    <p className="text-sm mt-1 text-danger/80">{error}</p>
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
                    className="p-1 rounded-md hover:bg-fill text-fg-muted hover:text-fg transition-colors cursor-default"
                    title={t("assets.image.zoomOut")}
                >
                    <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-sm text-fg-muted min-w-16 text-center">
                    {controls.zoomLabel}
                </span>
                <button
                    onClick={controls.zoomIn}
                    className="p-1 rounded-md hover:bg-fill text-fg-muted hover:text-fg transition-colors cursor-default"
                    title={t("assets.image.zoomIn")}
                >
                    <ZoomIn className="w-4 h-4" />
                </button>
                <button
                    onClick={controls.resetView}
                    className="p-1 rounded-md hover:bg-fill text-fg-muted hover:text-fg transition-colors cursor-default ml-2"
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

    // Declared before the registration effect so that on unmount this tab is out of the map by the
    // time the group's cleanup asks whether any preview is left.
    useEffect(() => {
        mountedPreviews.set(tabId, controlsRef);
        return () => {
            mountedPreviews.delete(tabId);
        };
    }, [tabId]);

    /** Run a view command against the preview the author is looking at, not this one. */
    const withFocusedPreview = useCallback(
        (run: (controls: ImagePixelPreviewControls) => void) => {
            if (!context) return;
            const focus = context.services.get<UIService>(Services.UI).focus.getFocus();
            if (focus.area !== FocusArea.Editor || !focus.targetId) return;
            const controls = mountedPreviews.get(focus.targetId)?.current;
            if (controls) {
                run(controls);
            }
        },
        [context],
    );

    const handleZoomIn = useCallback(() => withFocusedPreview(controls => controls.zoomIn()), [withFocusedPreview]);
    const handleZoomOut = useCallback(() => withFocusedPreview(controls => controls.zoomOut()), [withFocusedPreview]);
    const handleResetView = useCallback(() => withFocusedPreview(controls => controls.resetView()), [withFocusedPreview]);

    useEffect(() => {
        const groupId = IMAGE_PREVIEW_GROUP_ID;

        // Any focused image preview, since the group is shared by all of them.
        const focusWhen = (ctx: any) =>
            ctx?.area === FocusArea.Editor && typeof ctx?.targetId === "string" && mountedPreviews.has(ctx.targetId);

        const zoomInAction: ActionDefinition = {
            id: `${groupId}-zoom-in`,
            icon: <ZoomIn className="w-4 h-4" />,
            label: t("assets.image.zoomIn"),
            shortcut: "mod+=",
            onClick: handleZoomIn,
            order: 1,
            when: focusWhen,
        };

        const zoomOutAction: ActionDefinition = {
            id: `${groupId}-zoom-out`,
            icon: <ZoomOut className="w-4 h-4" />,
            label: t("assets.image.zoomOut"),
            shortcut: "mod+-",
            onClick: handleZoomOut,
            order: 2,
            when: focusWhen,
        };

        const resetViewAction: ActionDefinition = {
            id: `${groupId}-reset-view`,
            icon: <RefreshCw className="w-4 h-4" />,
            label: t("assets.image.resetView"),
            shortcut: "mod+0",
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
            // Only the last preview standing takes the group down; anything else would leave a tab
            // that is still open with no Preview menu.
            if (mountedPreviews.size === 0) {
                unregisterActionGroup(groupId);
            }
        };
    }, [handleResetView, handleZoomIn, handleZoomOut, registerActionGroup, unregisterActionGroup, t]);

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
