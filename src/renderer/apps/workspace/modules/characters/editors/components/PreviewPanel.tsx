import React, { useEffect, useMemo, useState } from "react";
import { CharacterForm } from "@/lib/workspace/services/character/types";
import { AlertCircle, RefreshCw } from "lucide-react";
import { AssetView } from "./types";

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
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });

    useEffect(() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    }, [view?.url]);

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom(prev => Math.max(0.1, Math.min(5, prev * delta)));
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 0) {
            setIsPanning(true);
            setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isPanning) {
            setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
        }
    };

    const handleMouseUp = () => setIsPanning(false);

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

    return (
        <div className="h-full flex flex-col bg-[#0f1115]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#1e1f22]">
                <div className="flex items-center gap-4 text-xs text-gray-300">
                    {view.metadata ? (
                        <>
                            <span>{view.metadata.width} × {view.metadata.height}</span>
                            <span className="text-gray-400">{view.metadata.format.toUpperCase()}</span>
                            <span className="text-gray-400">{(view.metadata.size / 1024).toFixed(1)} KB</span>
                        </>
                    ) : (
                        <span className="text-gray-400">No metadata</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" onClick={() => setZoom(prev => Math.max(0.1, prev / 1.2))}>
                        -
                    </button>
                    <span className="text-sm text-gray-300 min-w-14 text-center">{(zoom * 100).toFixed(0)}%</span>
                    <button className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" onClick={() => setZoom(prev => Math.min(5, prev * 1.2))}>
                        +
                    </button>
                    <button
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors ml-2"
                        onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>
            <div
                className="flex-1 overflow-hidden flex items-center justify-center cursor-move"
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <img
                    src={view.url}
                    alt="Variant preview"
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        maxWidth: "100%",
                        maxHeight: "100%",
                        objectFit: "contain",
                        userSelect: "none",
                        pointerEvents: "none",
                    }}
                    draggable={false}
                />
            </div>
        </div>
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

