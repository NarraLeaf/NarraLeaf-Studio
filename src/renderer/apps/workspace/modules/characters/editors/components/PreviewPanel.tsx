import { useMemo, type ReactNode } from "react";
import { CharacterForm } from "@/lib/workspace/services/character/types";
import { AlertCircle, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
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
    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-[#0f1115]">
                <div className="flex items-center gap-2 text-gray-400">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>Loading preview...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-full flex items-center justify-center bg-[#0f1115] p-4">
                <div className="flex items-start gap-2 text-red-400 bg-red-500/10 rounded-md p-4 max-w-md">
                    <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="font-medium">Preview failed</p>
                        <p className="text-sm mt-1 text-red-300">{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!view?.url) {
        return (
            <div className="h-full flex items-center justify-center bg-[#0f1115] text-gray-500">
                Select a variant with an image to preview
            </div>
        );
    }

    const renderToolbar = (controls: ImagePixelPreviewControls): ReactNode => {
        const size = controls.imageSize ?? view.metadata;

        return (
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#1e1f22]">
                <div className="flex items-center gap-4 text-xs text-gray-300">
                    {view.metadata ? (
                        <>
                            <span>{size ? `${size.width} x ${size.height}` : "No size"}</span>
                            <span className="text-gray-400">{view.metadata.format.toUpperCase()}</span>
                            <span className="text-gray-400">{(view.metadata.size / 1024).toFixed(1)} KB</span>
                        </>
                    ) : (
                        <span className="text-gray-400">{size ? `${size.width} x ${size.height}` : "No metadata"}</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                        onClick={controls.zoomOut}
                        title="Zoom Out"
                    >
                        <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-sm text-gray-300 min-w-14 text-center">{controls.zoomLabel}</span>
                    <button
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                        onClick={controls.zoomIn}
                        title="Zoom In"
                    >
                        <ZoomIn className="w-4 h-4" />
                    </button>
                    <button
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors ml-2"
                        onClick={controls.resetView}
                        title="Reset View"
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
            alt="Variant preview"
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
}: PreviewPanelProps) {
    const label = useMemo(() => {
        if (!activeForm) return "Preview";
        return `Current form: ${activeForm.name}`;
    }, [activeForm]);

    return (
        <div className="flex flex-col">
            <div className="px-4 py-2 border-b border-white/10 flex items-center gap-3">
                <span className="text-sm font-semibold">Preview</span>
                <span className="text-xs text-gray-500">{label}</span>
                {previewVariant && <span className="text-xs text-gray-400">Variant: {previewVariant}</span>}
            </div>
            <VariantPreview view={previewAsset} loading={previewLoading} error={previewError} />
        </div>
    );
}
