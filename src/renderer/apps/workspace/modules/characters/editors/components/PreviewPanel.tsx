import { useMemo, type ReactNode } from "react";
import { CharacterForm } from "@/lib/workspace/services/character/types";
import { useTranslation } from "@/lib/i18n";
import { AlertCircle, Crop, RefreshCw, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { AssetView } from "./types";
import {
    ImagePixelPreview,
    type ImagePixelPreviewControls,
} from "@/apps/workspace/modules/assets/components/ImagePixelPreview";

type PreviewPanelProps = {
    activeForm: CharacterForm | null;
    previewVariant: string | null;
    previewAsset: AssetView | null;
    previewLoading: boolean;
    previewError: string | null;
    /** Whether the current preview can be portrait-framed (has an image with known dimensions). */
    canEditPortrait: boolean;
    /** Whether a portrait framing rect is currently set (enables the reset affordance). */
    portraitSet: boolean;
    onEditPortrait: () => void;
    onResetPortrait: () => void;
};

function VariantPreview({
    view,
    loading,
    error,
}: {
    view: AssetView | null;
    loading: boolean;
    error: string | null;
}) {
    const { t } = useTranslation();
    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-surface">
                <div className="flex items-center gap-2 text-fg-muted">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>{t("characters.preview.loading")}</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-full flex items-center justify-center bg-surface p-4">
                <div className="flex items-start gap-2 text-danger bg-danger/10 rounded-md p-4 max-w-md">
                    <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="font-medium">{t("characters.preview.failed")}</p>
                        <p className="text-sm mt-1 text-danger/80">{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!view?.url) {
        return (
            <div className="h-full flex items-center justify-center bg-surface text-fg-subtle">
                {t("characters.preview.placeholder")}
            </div>
        );
    }

    const renderToolbar = (controls: ImagePixelPreviewControls): ReactNode => {
        const size = controls.imageSize ?? view.metadata;

        return (
            <div className="flex items-center justify-between px-4 py-2 border-b border-edge bg-surface-raised">
                <div className="flex items-center gap-4 text-xs text-fg-muted">
                    {view.metadata ? (
                        <>
                            <span>{size ? `${size.width} x ${size.height}` : t("characters.preview.noSize")}</span>
                            <span className="text-fg-muted">{view.metadata.format.toUpperCase()}</span>
                            <span className="text-fg-muted">{(view.metadata.size / 1024).toFixed(1)} KB</span>
                        </>
                    ) : (
                        <span className="text-fg-muted">{size ? `${size.width} x ${size.height}` : t("characters.preview.noMetadata")}</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        className="p-1 rounded hover:bg-fill text-fg-muted hover:text-fg transition-colors"
                        onClick={controls.zoomOut}
                        title={t("characters.preview.zoomOut")}
                    >
                        <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-sm text-fg-muted min-w-14 text-center">{controls.zoomLabel}</span>
                    <button
                        className="p-1 rounded hover:bg-fill text-fg-muted hover:text-fg transition-colors"
                        onClick={controls.zoomIn}
                        title={t("characters.preview.zoomIn")}
                    >
                        <ZoomIn className="w-4 h-4" />
                    </button>
                    <button
                        className="p-1 rounded hover:bg-fill text-fg-muted hover:text-fg transition-colors ml-2"
                        onClick={controls.resetView}
                        title={t("characters.preview.resetView")}
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );
    };

    return (
        <ImagePixelPreview
            src={view.url}
            alt={t("characters.preview.alt")}
            initialSize={view.metadata ? { width: view.metadata.width, height: view.metadata.height } : null}
            resetKey={view.url}
            renderToolbar={renderToolbar}
        />
    );
}

export function PreviewPanel({
    activeForm,
    previewVariant,
    previewAsset,
    previewLoading,
    previewError,
    canEditPortrait,
    portraitSet,
    onEditPortrait,
    onResetPortrait,
}: PreviewPanelProps) {
    const { t } = useTranslation();
    const label = useMemo(() => {
        if (!activeForm) return t("characters.preview.title");
        return t("characters.preview.currentForm", { name: activeForm.name });
    }, [activeForm, t]);

    return (
        <div className="group flex flex-col">
            <div className="px-4 py-2 border-b border-edge flex items-center gap-3">
                <span className="text-sm font-semibold">{t("characters.preview.title")}</span>
                <span className="text-xs text-fg-subtle">{label}</span>
                {previewVariant && <span className="text-xs text-fg-muted">{t("characters.preview.variant", { name: previewVariant })}</span>}
                {canEditPortrait ? (
                    <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                            className="p-1 rounded hover:bg-fill text-fg-muted hover:text-fg transition-colors"
                            onClick={onEditPortrait}
                            title={t("characters.preview.setPortrait")}
                            aria-label={t("characters.preview.setPortrait")}
                        >
                            <Crop className="w-4 h-4" />
                        </button>
                        {portraitSet ? (
                            <button
                                className="p-1 rounded hover:bg-fill text-fg-muted hover:text-fg transition-colors"
                                onClick={onResetPortrait}
                                title={t("characters.preview.resetPortrait")}
                                aria-label={t("characters.preview.resetPortrait")}
                            >
                                <RotateCcw className="w-4 h-4" />
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>
            <VariantPreview view={previewAsset} loading={previewLoading} error={previewError} />
        </div>
    );
}
