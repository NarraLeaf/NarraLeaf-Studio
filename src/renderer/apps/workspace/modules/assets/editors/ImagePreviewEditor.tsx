import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
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
import { useKeybindings, whenFocused, type KeybindingDefinition } from "@/apps/workspace/hooks";
import { useShortcutLabels } from "../../../hooks/useShortcutLabels";
import { useAssetReadNotice, type AssetReadFailure } from "./useAssetReadNotice";
import { useFollowedAsset } from "./useFollowedAsset";
import { EditorProjectUndoKeybindings } from "@/apps/workspace/components/layout/EditorProjectUndoKeybindings";
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
    const shortcuts = useShortcutLabels();
    const size = controls.imageSize ?? imageData.metadata;

    return (
        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-edge bg-surface-raised">
            {/* Each value is one unit: it never breaks across lines and is never cut short. In a
                narrow editor group the values that do not fit drop out whole, from the right - the
                file size first, then the format, the pixel size last - by wrapping onto a second line
                this one-line-high strip does not show. The empty first item is what lets the pixel
                size wrap away too: a flex line keeps its first item however wide it is. The zoom
                controls never give up their room to them. */}
            <div className="flex h-5 min-w-0 flex-1 flex-wrap content-start items-center overflow-hidden whitespace-nowrap text-sm text-fg-muted">
                <span aria-hidden className="h-5 w-0" />
                <span>
                    {size.width} × {size.height}
                </span>
                <span className="ml-4">
                    {imageData.metadata.format.toUpperCase()}
                </span>
                <span className="ml-4">
                    {(imageData.metadata.size / 1024).toFixed(1)} KB
                </span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                <button
                    onClick={controls.zoomOut}
                    className="p-1 rounded-md hover:bg-fill text-fg-muted hover:text-fg transition-colors cursor-default"
                    data-tip={t("assets.image.zoomOut")} aria-label={t("assets.image.zoomOut")}
                    data-tip-shortcut={shortcuts.forBinding("assets.image.zoom-out")}
                >
                    <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-sm text-fg-muted min-w-12 text-center whitespace-nowrap">
                    {controls.zoomLabel}
                </span>
                <button
                    onClick={controls.zoomIn}
                    className="p-1 rounded-md hover:bg-fill text-fg-muted hover:text-fg transition-colors cursor-default"
                    data-tip={t("assets.image.zoomIn")} aria-label={t("assets.image.zoomIn")}
                    data-tip-shortcut={shortcuts.forBinding("assets.image.zoom-in")}
                >
                    <ZoomIn className="w-4 h-4" />
                </button>
                <button
                    onClick={controls.resetView}
                    className="p-1 rounded-md hover:bg-fill text-fg-muted hover:text-fg transition-colors cursor-default"
                    data-tip={t("assets.image.resetView")} aria-label={t("assets.image.resetView")}
                    data-tip-shortcut={shortcuts.forBinding("assets.image.reset-view")}
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
    // The record as the library holds it now, so a replaced file is read again (see the hook).
    const asset = useFollowedAsset(payload?.asset);
    const [state, setState] = useState<{
        imageData: AssetData<AssetType.Image> | null;
        loading: boolean;
        failure: AssetReadFailure | null;
        url: string | null;
        /** The asset `url` was read from. */
        assetId: string | null;
    }>({
        imageData: null,
        loading: true,
        failure: null,
        url: null,
        assetId: null,
    });
    const notice = useAssetReadNotice(asset?.id, state.failure);

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

    // The keys, per tab: each preview registers the catalog's `assets.image.*` against its own view,
    // live while that tab has focus, so they can be rebound in Settings. The shared Preview group
    // below prints the same chords through `shortcutId` and registers none - an action's own
    // `shortcut` makes a binding no catalog entry governs, which is how these three were once
    // missing from the Settings table and listed under Other on the cheat sheet.
    const viewKeys = useMemo((): KeybindingDefinition[] => [
        {
            id: "zoom-in",
            key: "mod+=",
            description: t("assets.image.keybindings.zoomIn"),
            handler: () => controlsRef.current?.zoomIn(),
        },
        {
            id: "zoom-out",
            key: "mod+-",
            description: t("assets.image.keybindings.zoomOut"),
            handler: () => controlsRef.current?.zoomOut(),
        },
        {
            id: "reset-view",
            key: "mod+0",
            description: t("assets.image.keybindings.resetView"),
            handler: () => controlsRef.current?.resetView(),
        },
    ], [t]);

    useKeybindings({
        keybindings: viewKeys,
        when: whenFocused(FocusArea.Editor, tabId),
        idPrefix: `image-preview-${tabId}`,
        catalogPrefix: "assets.image.",
    });

    useEffect(() => {
        const groupId = IMAGE_PREVIEW_GROUP_ID;

        // Any focused image preview, since the group is shared by all of them.
        const focusWhen = (ctx: any) =>
            ctx?.area === FocusArea.Editor && typeof ctx?.targetId === "string" && mountedPreviews.has(ctx.targetId);

        const zoomInAction: ActionDefinition = {
            id: `${groupId}-zoom-in`,
            icon: <ZoomIn className="w-4 h-4" />,
            label: t("assets.image.zoomIn"),
            shortcutId: "assets.image.zoom-in",
            onClick: handleZoomIn,
            order: 1,
            when: focusWhen,
        };

        const zoomOutAction: ActionDefinition = {
            id: `${groupId}-zoom-out`,
            icon: <ZoomOut className="w-4 h-4" />,
            label: t("assets.image.zoomOut"),
            shortcutId: "assets.image.zoom-out",
            onClick: handleZoomOut,
            order: 2,
            when: focusWhen,
        };

        const resetViewAction: ActionDefinition = {
            id: `${groupId}-reset-view`,
            icon: <RefreshCw className="w-4 h-4" />,
            label: t("assets.image.resetView"),
            shortcutId: "assets.image.reset-view",
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
            // A re-read after the file was replaced keeps the picture it has until the new one is in,
            // rather than blanking the tab to a spinner. Another asset starts from the spinner.
            setState(prev => ({ ...prev, loading: prev.url === null || prev.assetId !== asset.id, failure: null }));

            try {
                const assetsService = context.services.get<AssetsService>(Services.Assets);
                const result = await assetsService.fetch(asset);

                if (cancelled) {
                    return;
                }

                if (!result.success) {
                    console.warn(`[assets] could not read ${asset.id}: ${result.error ?? ""}`);
                    setState({
                        imageData: null,
                        loading: false,
                        failure: { code: result.code },
                        url: null,
                        assetId: asset.id,
                    });
                    return;
                }

                const blob = new Blob([new Uint8Array(result.data.data)]);
                setState({
                    imageData: result.data,
                    loading: false,
                    failure: null,
                    url: URL.createObjectURL(blob),
                    assetId: asset.id,
                });
            } catch (err) {
                if (cancelled) {
                    return;
                }
                console.error("Failed to load image:", err);
                setState({
                    imageData: null,
                    loading: false,
                    failure: {},
                    url: null,
                    assetId: asset.id,
                });
            }
        };

        loadImage();

        return () => {
            cancelled = true;
        };
        // Keyed on the bytes, not on the record object: a replacement keeps the id and moves the hash.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [context, asset?.id, asset?.hash]);

    // Each object URL is let go once the picture drawn from it has been replaced, or the tab closes.
    useEffect(() => {
        const url = state.url;
        return () => {
            if (url) {
                URL.revokeObjectURL(url);
            }
        };
    }, [state.url]);

    const renderToolbar = (controls: ImagePixelPreviewControls): ReactNode => (
        <PreviewToolbar imageData={state.imageData!} controls={controls} />
    );

    return (
        <>
            {/* The picture's own steps - Replace File…, a conversion - are on the project's stack, and
                the preview is where the author looks at what they did. */}
            <EditorProjectUndoKeybindings tabId={tabId} />
            {state.loading ? (
                <LoadingState />
            ) : notice ? (
                <ErrorState error={notice} />
            ) : !state.imageData || !state.url ? null : (
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
            )}
        </>
    );
}
