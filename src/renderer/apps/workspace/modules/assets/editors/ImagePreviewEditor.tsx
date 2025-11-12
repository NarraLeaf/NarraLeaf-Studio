import { useState, useEffect, useRef } from "react";
import { ZoomIn, ZoomOut, RefreshCw, AlertCircle } from "lucide-react";
import { EditorComponentProps } from "../../types";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";

interface ImagePreviewPayload {
    asset: Asset<AssetType.Image>;
}

/**
 * Image preview editor component
 * Displays image with zoom and pan controls
 */
export function ImagePreviewEditor({ tabId, payload }: EditorComponentProps<ImagePreviewPayload>) {
    const { context } = useWorkspace();
    const [imageData, setImageData] = useState<AssetData<AssetType.Image> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const imageUrl = useRef<string | null>(null);

    const asset = payload?.asset;

    // Load image data
    useEffect(() => {
        if (!context || !asset) return;

        const loadImage = async () => {
            setLoading(true);
            setError(null);

            try {
                const assetsService = context.services.get<AssetsService>(Services.Assets);
                const result = await assetsService.fetch(asset);

                if (!result.success) {
                    setError(result.error || "Failed to load image");
                    return;
                }

                setImageData(result.data);

                // Create blob URL for image
                const blob = new Blob([new Uint8Array(result.data.data)]);
                if (imageUrl.current) {
                    URL.revokeObjectURL(imageUrl.current);
                }
                imageUrl.current = URL.createObjectURL(blob);
            } catch (err) {
                console.error("Failed to load image:", err);
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setLoading(false);
            }
        };

        loadImage();

        return () => {
            if (imageUrl.current) {
                URL.revokeObjectURL(imageUrl.current);
            }
        };
    }, [context, asset]);

    // Mouse wheel zoom
    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom(prev => Math.max(0.1, Math.min(5, prev * delta)));
    };

    // Pan controls
    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 0) { // Left click
            setIsPanning(true);
            setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isPanning) {
            setPan({
                x: e.clientX - panStart.x,
                y: e.clientY - panStart.y,
            });
        }
    };

    const handleMouseUp = () => {
        setIsPanning(false);
    };

    const handleZoomIn = () => {
        setZoom(prev => Math.min(5, prev * 1.2));
    };

    const handleZoomOut = () => {
        setZoom(prev => Math.max(0.1, prev / 1.2));
    };

    const handleResetView = () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-[#0f1115]">
                <div className="flex items-center gap-2 text-gray-400">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>Loading image...</span>
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
                        <p className="font-medium">Failed to load image</p>
                        <p className="text-sm mt-1 text-red-300">{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!imageData || !imageUrl.current) {
        return null;
    }

    return (
        <div className="h-full flex flex-col bg-[#0f1115]">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#1e1f22]">
                <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-300">
                        {imageData.metadata.width} × {imageData.metadata.height}
                    </span>
                    <span className="text-sm text-gray-400">
                        {imageData.metadata.format.toUpperCase()}
                    </span>
                    <span className="text-sm text-gray-400">
                        {(imageData.metadata.size / 1024).toFixed(1)} KB
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={handleZoomOut}
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-default"
                        title="Zoom Out"
                    >
                        <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-sm text-gray-400 min-w-16 text-center">
                        {(zoom * 100).toFixed(0)}%
                    </span>
                    <button
                        onClick={handleZoomIn}
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-default"
                        title="Zoom In">
                        <ZoomIn className="w-4 h-4" />
                    </button>
                    <button
                        onClick={handleResetView}
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-default ml-2"
                        title="Reset View"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Image viewer */}
            <div
                ref={containerRef}
                className="flex-1 overflow-hidden flex items-center justify-center cursor-move"
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <img
                    src={imageUrl.current}
                    alt={asset?.name}
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        maxWidth: '100%',
                        maxHeight: '100%',
                        objectFit: 'contain',
                        userSelect: 'none',
                        pointerEvents: 'none',
                    }}
                    draggable={false}
                />
            </div>
        </div>
    );
}

