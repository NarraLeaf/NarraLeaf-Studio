import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
    type MutableRefObject,
    type ReactNode,
    type SyntheticEvent,
} from "react";

export type ImagePixelSize = {
    width: number;
    height: number;
};

export type ImagePixelPreviewControls = {
    zoom: number;
    zoomLabel: string;
    imageSize: ImagePixelSize | null;
    zoomIn: () => void;
    zoomOut: () => void;
    resetView: () => void;
};

type ImageViewTransform = {
    zoom: number;
    offsetX: number;
    offsetY: number;
};

type ImagePixelPreviewProps = {
    src: string;
    alt?: string;
    initialSize?: ImagePixelSize | null;
    resetKey?: string | null;
    controlsRef?: MutableRefObject<ImagePixelPreviewControls | null>;
    renderToolbar?: (controls: ImagePixelPreviewControls) => ReactNode;
};

const MIN_ZOOM = 0.001;
const MAX_ZOOM = 16;
const INITIAL_FIT_PADDING_PX = 32;

function clampZoom(value: number): number {
    if (!Number.isFinite(value)) {
        return 1;
    }
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function formatZoomPercent(zoom: number): string {
    const percent = zoom * 100;
    if (percent >= 10) {
        return percent.toFixed(0);
    }
    if (percent >= 1) {
        return percent.toFixed(1);
    }
    return percent.toFixed(2);
}

function computeInitialFitView(containerSize: ImagePixelSize, imageSize: ImagePixelSize): ImageViewTransform {
    if (containerSize.width <= 0 || containerSize.height <= 0 || imageSize.width <= 0 || imageSize.height <= 0) {
        return { zoom: 1, offsetX: 0, offsetY: 0 };
    }

    const horizontalPadding = Math.min(INITIAL_FIT_PADDING_PX * 2, Math.max(0, containerSize.width - 1));
    const verticalPadding = Math.min(INITIAL_FIT_PADDING_PX * 2, Math.max(0, containerSize.height - 1));
    const availableWidth = Math.max(1, containerSize.width - horizontalPadding);
    const availableHeight = Math.max(1, containerSize.height - verticalPadding);
    const zoom = clampZoom(Math.min(1, availableWidth / imageSize.width, availableHeight / imageSize.height));

    return {
        zoom,
        offsetX: (containerSize.width - imageSize.width * zoom) / 2,
        offsetY: (containerSize.height - imageSize.height * zoom) / 2,
    };
}

function hasSizeChanged(a: ImagePixelSize | null, b: ImagePixelSize): boolean {
    return a?.width !== b.width || a.height !== b.height;
}

export function ImagePixelPreview({
    src,
    alt,
    initialSize,
    resetKey,
    controlsRef,
    renderToolbar,
}: ImagePixelPreviewProps) {
    const [imageSize, setImageSize] = useState<ImagePixelSize | null>(initialSize ?? null);
    const [view, setView] = useState<ImageViewTransform>({ zoom: 1, offsetX: 0, offsetY: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef(view);
    const initializedKeyRef = useRef<string | null>(null);
    const panStartRef = useRef<{ clientX: number; clientY: number; offsetX: number; offsetY: number } | null>(null);
    const currentResetKey = resetKey ?? src;
    const initialWidth = initialSize?.width;
    const initialHeight = initialSize?.height;
    viewRef.current = view;

    useEffect(() => {
        initializedKeyRef.current = null;
        panStartRef.current = null;
        setIsPanning(false);
        setImageSize(initialWidth && initialHeight ? { width: initialWidth, height: initialHeight } : null);
        setView({ zoom: 1, offsetX: 0, offsetY: 0 });
    }, [currentResetKey, initialHeight, initialWidth]);

    const zoomAroundViewportPoint = useCallback((point: { x: number; y: number }, factor: number) => {
        setView(prev => {
            const nextZoom = clampZoom(prev.zoom * factor);
            if (nextZoom === prev.zoom) {
                return prev;
            }

            const ratio = nextZoom / prev.zoom;
            return {
                zoom: nextZoom,
                offsetX: point.x - (point.x - prev.offsetX) * ratio,
                offsetY: point.y - (point.y - prev.offsetY) * ratio,
            };
        });
    }, []);

    const zoomAroundViewportCenter = useCallback((factor: number) => {
        const container = containerRef.current;
        if (!container) {
            return;
        }

        const rect = container.getBoundingClientRect();
        zoomAroundViewportPoint({ x: rect.width / 2, y: rect.height / 2 }, factor);
    }, [zoomAroundViewportPoint]);

    const applyInitialFitView = useCallback((): boolean => {
        const container = containerRef.current;
        if (!container || !imageSize) {
            return false;
        }

        const rect = container.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        setView(computeInitialFitView({ width: rect.width, height: rect.height }, imageSize));
        initializedKeyRef.current = currentResetKey;
        return true;
    }, [currentResetKey, imageSize]);

    const zoomIn = useCallback(() => {
        zoomAroundViewportCenter(1.2);
    }, [zoomAroundViewportCenter]);

    const zoomOut = useCallback(() => {
        zoomAroundViewportCenter(1 / 1.2);
    }, [zoomAroundViewportCenter]);

    const resetView = useCallback(() => {
        if (!applyInitialFitView()) {
            setView({ zoom: 1, offsetX: 0, offsetY: 0 });
        }
    }, [applyInitialFitView]);

    useLayoutEffect(() => {
        if (!imageSize || initializedKeyRef.current === currentResetKey) {
            return;
        }

        if (applyInitialFitView()) {
            return;
        }

        const container = containerRef.current;
        if (!container || !("ResizeObserver" in window)) {
            return;
        }

        const observer = new ResizeObserver(() => {
            if (applyInitialFitView()) {
                observer.disconnect();
            }
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [applyInitialFitView, currentResetKey, imageSize]);

    const controls = useMemo<ImagePixelPreviewControls>(() => ({
        zoom: view.zoom,
        zoomLabel: `${formatZoomPercent(view.zoom)}%`,
        imageSize,
        zoomIn,
        zoomOut,
        resetView,
    }), [imageSize, resetView, view.zoom, zoomIn, zoomOut]);

    useLayoutEffect(() => {
        if (!controlsRef) {
            return;
        }

        controlsRef.current = controls;
        return () => {
            controlsRef.current = null;
        };
    }, [controls, controlsRef]);

    const handleWheel = useCallback((e: WheelEvent) => {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const delta = e.deltaY > 0 ? 1 / 1.1 : 1.1;
        zoomAroundViewportPoint({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        }, delta);
    }, [zoomAroundViewportPoint]);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }

        container.addEventListener("wheel", handleWheel, { passive: false });
        return () => container.removeEventListener("wheel", handleWheel);
    }, [handleWheel]);

    const handleMouseDown = (e: ReactMouseEvent) => {
        if (e.button === 0) {
            e.preventDefault();
            setIsPanning(true);
            panStartRef.current = {
                clientX: e.clientX,
                clientY: e.clientY,
                offsetX: viewRef.current.offsetX,
                offsetY: viewRef.current.offsetY,
            };
        }
    };

    const handleMouseMove = (e: ReactMouseEvent) => {
        const start = panStartRef.current;
        if (isPanning && start) {
            setView(prev => ({
                ...prev,
                offsetX: start.offsetX + e.clientX - start.clientX,
                offsetY: start.offsetY + e.clientY - start.clientY,
            }));
        }
    };

    const handleMouseUp = () => {
        setIsPanning(false);
        panStartRef.current = null;
    };

    const handleImageLoad = (e: SyntheticEvent<HTMLImageElement>) => {
        const nextSize = {
            width: e.currentTarget.naturalWidth,
            height: e.currentTarget.naturalHeight,
        };

        if (nextSize.width <= 0 || nextSize.height <= 0) {
            return;
        }

        setImageSize(prev => {
            if (!hasSizeChanged(prev, nextSize)) {
                return prev;
            }

            initializedKeyRef.current = null;
            return nextSize;
        });
    };

    return (
        <div className="h-full flex flex-col bg-surface">
            {renderToolbar?.(controls)}
            <div
                ref={containerRef}
                className={`relative flex-1 overflow-hidden ${isPanning ? "cursor-grabbing" : "cursor-move"}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <img
                    src={src}
                    alt={alt}
                    style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        width: imageSize?.width,
                        height: imageSize?.height,
                        maxWidth: "none",
                        maxHeight: "none",
                        transform: `matrix(${view.zoom}, 0, 0, ${view.zoom}, ${view.offsetX}, ${view.offsetY})`,
                        transformOrigin: "0 0",
                        visibility: imageSize ? "visible" : "hidden",
                        userSelect: "none",
                        pointerEvents: "none",
                    }}
                    onLoad={handleImageLoad}
                    draggable={false}
                />
            </div>
        </div>
    );
}
