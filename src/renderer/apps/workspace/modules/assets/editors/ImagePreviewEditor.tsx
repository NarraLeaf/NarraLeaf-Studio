import { useState, useEffect, useRef } from "react";
import { ZoomIn, ZoomOut, RefreshCw, AlertCircle } from "lucide-react";
import { EditorComponentProps } from "../../types";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { ActionDefinition, useRegistry } from "../../../registry";
import { Image as ImageIcon } from "lucide-react";
import { FocusArea, Keybinding } from "@/lib/workspace/services/ui/types";
import { UIService } from "@/lib/workspace/services/core/UIService";

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
    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;

    // Access registry to register action group when this editor is focused
    const { registerActionGroup, unregisterActionGroup } = useRegistry();

    // Register editor-specific action group on mount and cleanup on unmount
    useEffect(() => {
        const groupId = `${tabId}-image-preview-actions`;

        const focusWhen = (ctx: any) => ctx?.area === FocusArea.Editor && ctx?.targetId === tabId;
        const namespace = "narraleaf-studio:image-preview";

        // Helper actions manipulating component state
        const zoomInAction: ActionDefinition = {
            id: `${namespace}:${groupId}-zoom-in`,
            icon: <ZoomIn className="w-4 h-4" />,
            label: "Zoom In",
            shortcut: "ctrl+=",
            onClick: () => setZoom((prev) => Math.min(5, prev * 1.2)),
            order: 1,
            when: focusWhen,
        };

        const zoomOutAction: ActionDefinition = {
            id: `${namespace}:${groupId}-zoom-out`,
            icon: <ZoomOut className="w-4 h-4" />,
            label: "Zoom Out",
            shortcut: "ctrl+-",
            onClick: () => setZoom((prev) => Math.max(0.1, prev / 1.2)),
            order: 2,
            when: focusWhen,
        };

        const resetViewAction: ActionDefinition = {
            id: `${namespace}:${groupId}-reset-view`,
            icon: <RefreshCw className="w-4 h-4" />,
            label: "Reset View",
            shortcut: "ctrl+0",
            onClick: () => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
            },
            order: 3,
            when: focusWhen,
        };

        registerActionGroup({
            id: groupId,
            label: "Preview",
            actions: [zoomOutAction, zoomInAction, resetViewAction],
        });

        return () => {
            unregisterActionGroup(groupId);
        };
    }, [registerActionGroup, unregisterActionGroup, tabId]);

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

    // Mouse wheel zoom: keep the point under the cursor fixed (scale anchor at cursor).
    // Image is flex-centered; transform is translate(pan) + scale(zoom) with origin at image center,
    // so visual center = viewport center + pan. Adjust pan when zoom changes.
    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const fx = mx - w / 2;
        const fy = my - h / 2;

        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const prevZoom = zoomRef.current;
        const newZoom = Math.max(0.1, Math.min(5, prevZoom * delta));
        const ratio = newZoom / prevZoom;
        if (ratio !== 1) {
            setPan((p) => ({
                x: p.x * ratio + fx * (1 - ratio),
                y: p.y * ratio + fy * (1 - ratio),
            }));
        }
        setZoom(newZoom);
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

