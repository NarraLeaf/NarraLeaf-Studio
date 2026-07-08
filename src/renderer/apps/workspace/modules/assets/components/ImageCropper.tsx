import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Crop, RefreshCw, X } from "lucide-react";

type CropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type Size = { width: number; height: number };

export interface ImageCropperProps {
    visible: boolean;
    imageUrl: string;
    initialSelection?: CropRect;
    lockedSize?: Size;
    aspectRatio?: number;
    minSize?: Size;
    maxSize?: Size;
    anchorRef?: React.RefObject<HTMLElement | null>;
    title?: string;
    className?: string;
    onClose: () => void;
    onConfirm: (selection: CropRect) => void;
    onChange?: (selection: CropRect) => void;
}

type DragHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type DragState = {
    handle: DragHandle;
    startRect: CropRect;
    startPoint: { x: number; y: number }; // image-space point
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const WINDOW_TITLEBAR_HEIGHT = 40;

export function ImageCropper({
    visible,
    imageUrl,
    initialSelection,
    lockedSize,
    aspectRatio,
    minSize = { width: 48, height: 48 },
    maxSize,
    anchorRef,
    title = "Crop Image",
    className = "",
    onClose,
    onConfirm,
    onChange,
}: ImageCropperProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [imageSize, setImageSize] = useState<Size | null>(null);
    const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 });
    const [selection, setSelection] = useState<CropRect | null>(null);
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [anchorStyle, setAnchorStyle] = useState<{ top: number; left: number; width: number }>({
        top: 0,
        left: 0,
        width: 720,
    });

    const minWidth = Math.max(lockedSize?.width ?? minSize.width, 4);
    const minHeight = Math.max(lockedSize?.height ?? minSize.height, 4);

    const metrics = useMemo(() => {
        if (!imageSize || !containerSize.width || !containerSize.height) return null;
        const { width: cw, height: ch } = containerSize;
        const { width: iw, height: ih } = imageSize;
        const imageRatio = iw / ih;
        const containerRatio = cw / ch;

        let displayWidth: number;
        let displayHeight: number;
        if (imageRatio > containerRatio) {
            displayWidth = cw;
            displayHeight = cw / imageRatio;
        } else {
            displayHeight = ch;
            displayWidth = ch * imageRatio;
        }

        const offsetX = (cw - displayWidth) / 2;
        const offsetY = (ch - displayHeight) / 2;
        const scaleX = displayWidth / iw;
        const scaleY = displayHeight / ih;

        return { displayWidth, displayHeight, offsetX, offsetY, scaleX, scaleY };
    }, [containerSize, imageSize]);

    const selectionDisplay = useMemo(() => {
        if (!selection || !metrics) return null;
        const left = metrics.offsetX + selection.x * metrics.scaleX;
        const top = metrics.offsetY + selection.y * metrics.scaleY;
        const width = selection.width * metrics.scaleX;
        const height = selection.height * metrics.scaleY;
        return { left, top, width, height };
    }, [metrics, selection]);

    const sanitizeRect = useCallback(
        (rect: CropRect, handle?: DragHandle): CropRect => {
        if (!imageSize) return rect;

        let next: CropRect = { ...rect };
        const maxWidth = Math.min(maxSize?.width ?? imageSize.width, imageSize.width);
        const maxHeight = Math.min(maxSize?.height ?? imageSize.height, imageSize.height);

        if (lockedSize) {
            next.width = lockedSize.width;
            next.height = lockedSize.height;
        } else if (aspectRatio) {
            const ratio = aspectRatio;
            const widthDriven = !handle || handle === "e" || handle === "w" || handle === "ne" || handle === "nw" || handle === "se" || handle === "sw";
            if (widthDriven) {
                const height = next.width / ratio;
                if (handle?.includes("n")) {
                    next.y += next.height - height;
                }
                next.height = height;
            } else {
                const width = next.height * ratio;
                if (handle?.includes("w")) {
                    next.x += next.width - width;
                }
                next.width = width;
            }
        }

        next.width = clamp(next.width, minWidth, maxWidth);
        next.height = clamp(next.height, minHeight, maxHeight);
        next.x = clamp(next.x, 0, imageSize.width - next.width);
        next.y = clamp(next.y, 0, imageSize.height - next.height);

        return next;
        },
        [aspectRatio, imageSize, lockedSize, maxSize?.height, maxSize?.width, minHeight, minWidth]
    );

    const buildDefaultSelection = useCallback(
        (size: Size): CropRect => {
            const targetWidth = lockedSize?.width ?? Math.min(size.width * 0.6, maxSize?.width ?? size.width);
            const targetHeight = lockedSize?.height ?? Math.min(size.height * 0.6, maxSize?.height ?? size.height);
            const width = clamp(targetWidth, minWidth, size.width);
            const height = clamp(targetHeight, minHeight, size.height);
            const x = (size.width - width) / 2;
            const y = (size.height - height) / 2;
            return sanitizeRect({ x, y, width, height });
        },
        [lockedSize?.height, lockedSize?.width, maxSize?.height, maxSize?.width, minHeight, minWidth, sanitizeRect]
    );

    const getImagePointFromClient = (clientX: number, clientY: number) => {
        if (!metrics || !containerRef.current || !imageSize) return null;
        const rect = containerRef.current.getBoundingClientRect();
        const x = (clientX - rect.left - metrics.offsetX) / metrics.scaleX;
        const y = (clientY - rect.top - metrics.offsetY) / metrics.scaleY;
        return {
            x: clamp(x, 0, imageSize.width),
            y: clamp(y, 0, imageSize.height),
        };
    };

    const handlePointerDownOnHandle = (handle: DragHandle) => (event: React.PointerEvent<HTMLDivElement>) => {
        if (!selection || !imageSize) return;
        event.preventDefault();
        event.stopPropagation(); // Avoid bubbling to parent move handler so resize works
        const point = getImagePointFromClient(event.clientX, event.clientY);
        if (!point) return;
        setDragState({
            handle,
            startRect: selection,
            startPoint: point,
        });
    };

    const handleContainerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!imageSize) return;
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).dataset.handle) return;
        const point = getImagePointFromClient(event.clientX, event.clientY);
        if (!point) return;

        if (lockedSize && selection) {
            // Locked size: treat as move
            handlePointerDownOnHandle("move")(event);
            return;
        }

        const startRect: CropRect = sanitizeRect({ x: point.x, y: point.y, width: 8, height: 8 });
        setSelection(startRect);
        setDragState({
            handle: "se",
            startRect,
            startPoint: point,
        });
    };

    const updateDragSelection = (clientX: number, clientY: number) => {
        if (!dragState || !imageSize) return;
        const point = getImagePointFromClient(clientX, clientY);
        if (!point) return;

        const dx = point.x - dragState.startPoint.x;
        const dy = point.y - dragState.startPoint.y;
        const { startRect, handle } = dragState;
        let draft = { ...startRect };

        switch (handle) {
            case "move":
                draft = { ...startRect, x: startRect.x + dx, y: startRect.y + dy };
                break;
            case "e":
                draft.width = startRect.width + dx;
                break;
            case "w":
                draft.x = startRect.x + dx;
                draft.width = startRect.width - dx;
                break;
            case "s":
                draft.height = startRect.height + dy;
                break;
            case "n":
                draft.y = startRect.y + dy;
                draft.height = startRect.height - dy;
                break;
            case "ne":
                draft.y = startRect.y + dy;
                draft.height = startRect.height - dy;
                draft.width = startRect.width + dx;
                break;
            case "nw":
                draft.x = startRect.x + dx;
                draft.width = startRect.width - dx;
                draft.y = startRect.y + dy;
                draft.height = startRect.height - dy;
                break;
            case "se":
                draft.width = startRect.width + dx;
                draft.height = startRect.height + dy;
                break;
            case "sw":
                draft.x = startRect.x + dx;
                draft.width = startRect.width - dx;
                draft.height = startRect.height + dy;
                break;
        }

        const constrained = sanitizeRect(draft, handle);
        setSelection(constrained);
    };

    useEffect(() => {
        if (!dragState) return;
        const handleMove = (event: PointerEvent) => {
            event.preventDefault();
            updateDragSelection(event.clientX, event.clientY);
        };
        const handleUp = () => setDragState(null);

        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp);
        return () => {
            window.removeEventListener("pointermove", handleMove);
            window.removeEventListener("pointerup", handleUp);
        };
    }, [dragState]);

    useEffect(() => {
        if (!visible) return;
        const container = containerRef.current;
        if (!container) return;

        const updateSize = () => {
            const rect = container.getBoundingClientRect();
            setContainerSize({ width: rect.width, height: rect.height });
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(container);
        window.addEventListener("resize", updateSize);

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener("resize", updateSize);
        };
    }, [visible]);

    useEffect(() => {
        if (!visible) return;
        setLoading(true);
        setError(null);
    }, [visible, imageUrl]);

    const handleImageLoad = () => {
        const img = imageRef.current;
        if (!img) return;
        const size = { width: img.naturalWidth, height: img.naturalHeight };
        setImageSize(size);
        setLoading(false);
        const nextSelection = initialSelection ? sanitizeRect(initialSelection) : buildDefaultSelection(size);
        setSelection(nextSelection);
    };

    const handleImageError = () => {
        setLoading(false);
        setError("Unable to load image");
    };

    useEffect(() => {
        if (!visible || !imageSize) return;
        if (initialSelection) {
            setSelection(sanitizeRect(initialSelection));
        }
    }, [initialSelection, sanitizeRect, imageSize, visible]);

    useEffect(() => {
        if (selection && onChange) {
            onChange(selection);
        }
    }, [selection, onChange]);

    useLayoutEffect(() => {
        if (!visible) return;

        const clampValue = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
        const viewportMargin = 12;
        const viewportTop = WINDOW_TITLEBAR_HEIGHT + viewportMargin;
        const defaultWidth = 720;
        const maxPanelHeight = 640;

        const updatePosition = () => {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            if (anchorRef?.current) {
                const rect = anchorRef.current.getBoundingClientRect();
                const width = clampValue(rect.width * 1.2, 520, 880);
                const availableBelow = viewportHeight - rect.bottom - viewportMargin;
                const availableAbove = rect.top - viewportTop;
                const shouldOpenDown = availableBelow >= maxPanelHeight || availableBelow >= availableAbove;
                let top = shouldOpenDown ? rect.bottom + 8 : rect.top - maxPanelHeight - 8;
                top = clampValue(top, viewportTop, Math.max(viewportTop, viewportHeight - viewportMargin - maxPanelHeight));
                const left = clampValue(rect.left, viewportMargin, viewportWidth - viewportMargin - width);
                setAnchorStyle({ top, left, width });
            } else {
                const width = defaultWidth;
                const left = clampValue((viewportWidth - width) / 2, viewportMargin, viewportWidth - viewportMargin - width);
                const top = clampValue(96, viewportTop, Math.max(viewportTop, viewportHeight - viewportMargin - maxPanelHeight));
                setAnchorStyle((prev) => ({ ...prev, top, left, width }));
            }
        };

        updatePosition();
        const handleReposition = () => updatePosition();
        window.addEventListener("resize", handleReposition);
        window.addEventListener("scroll", handleReposition, { passive: true });

        let resizeObserver: ResizeObserver | undefined;
        if (containerRef.current && "ResizeObserver" in window) {
            resizeObserver = new ResizeObserver(() => updatePosition());
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            window.removeEventListener("resize", handleReposition);
            window.removeEventListener("scroll", handleReposition);
            resizeObserver?.disconnect();
        };
    }, [anchorRef, visible]);

    if (!visible) {
        return null;
    }

    const headerLabel = title;
    const ready = selection && metrics && !loading && !error;

    const overlayPieces =
        selectionDisplay && metrics
            ? [
                  { style: { left: 0, top: 0, right: 0, height: selectionDisplay.top } },
                  { style: { left: 0, top: selectionDisplay.top, width: selectionDisplay.left, height: selectionDisplay.height } },
                  {
                      style: {
                          left: selectionDisplay.left + selectionDisplay.width,
                          top: selectionDisplay.top,
                          right: 0,
                          height: selectionDisplay.height,
                      },
                  },
                  { style: { left: 0, top: selectionDisplay.top + selectionDisplay.height, right: 0, bottom: 0 } },
              ]
            : [];

    const handleConfirm = () => {
        if (selection) {
            onConfirm(selection);
        }
    };

    const panel = (
        <div
            className="nl-window-content-layer z-50 bg-black/40"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
        >
            <div
                style={anchorRef?.current ? { position: "fixed", top: anchorStyle.top, left: anchorStyle.left, width: anchorStyle.width } : { width: anchorStyle.width }}
                className={`${anchorRef?.current ? "" : "mt-10 mx-auto"} bg-[#111218] border border-edge rounded-xl shadow-xl text-fg max-h-[640px] flex flex-col ${className}`}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
                    <div className="flex items-center gap-2">
                        <Crop className="w-4 h-4 text-primary" />
                        <div className="flex flex-col">
                            <span className="text-sm font-semibold">{headerLabel}</span>
                            <span className="text-xs text-fg-muted">
                                {imageSize ? `${imageSize.width}x${imageSize.height}px` : "Loading..."}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                const img = imageRef.current;
                                if (img) {
                                    setLoading(true);
                                    setError(null);
                                    img.src = imageUrl;
                                }
                            }}
                            className="p-1 rounded hover:bg-fill disabled:opacity-50"
                            disabled={loading}
                            title="Reload"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                        </button>
                        <button onClick={onClose} className="p-1 rounded hover:bg-fill" title="Close">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="p-4 space-y-3 border-b border-edge">
                    <div
                        ref={containerRef}
                        className="relative w-full h-[460px] bg-[#0d0f14] border border-edge-subtle rounded-lg overflow-hidden select-none"
                        onPointerDown={handleContainerPointerDown}
                    >
                        {loading && (
                            <div className="absolute inset-0 flex items-center justify-center text-fg-muted gap-2">
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                <span>Loading...</span>
                            </div>
                        )}

                        {error && (
                            <div className="absolute inset-0 flex items-center justify-center text-red-400 gap-2">
                                <AlertCircle className="w-4 h-4" />
                                <span>{error}</span>
                            </div>
                        )}

                        <img
                            ref={imageRef}
                            src={imageUrl}
                            alt="crop-target"
                            className="w-full h-full object-contain pointer-events-none select-none"
                            onLoad={handleImageLoad}
                            onError={handleImageError}
                            draggable={false}
                        />

                        {ready && selectionDisplay && (
                            <>
                                <div className="absolute inset-0 pointer-events-none">
                                    {overlayPieces.map((piece, idx) => (
                                        <div key={idx} className="absolute bg-black/35" style={piece.style} />
                                    ))}
                                </div>

                                <div
                                    className="absolute border-2 border-primary/70 bg-primary/5"
                                    style={selectionDisplay}
                                    onPointerDown={handlePointerDownOnHandle("move")}
                                    data-handle="move"
                                >
                                    {!lockedSize && (
                                        <>
                                            {/* Invisible edge hit areas: keep cursor feedback without visual bars */}
                                            {["n", "s", "e", "w"].map((dir) => (
                                                <div
                                                    key={dir}
                                                    data-handle={dir}
                                                    onPointerDown={handlePointerDownOnHandle(dir as DragHandle)}
                                                    className="absolute opacity-0"
                                                    style={
                                                        dir === "n"
                                                            ? { top: -6, left: "15%", right: "15%", height: 12, cursor: "ns-resize" }
                                                            : dir === "s"
                                                            ? { bottom: -6, left: "15%", right: "15%", height: 12, cursor: "ns-resize" }
                                                            : dir === "e"
                                                            ? { right: -6, top: "15%", bottom: "15%", width: 12, cursor: "ew-resize" }
                                                            : { left: -6, top: "15%", bottom: "15%", width: 12, cursor: "ew-resize" }
                                                    }
                                                />
                                            ))}

                                            {["ne", "nw", "se", "sw"].map((dir) => (
                                                <div
                                                    key={dir}
                                                    data-handle={dir}
                                                    onPointerDown={handlePointerDownOnHandle(dir as DragHandle)}
                                                    className="absolute w-3 h-3 bg-white rounded-sm border border-primary/60"
                                                    style={
                                                        dir === "ne"
                                                            ? { right: -4, top: -4, cursor: "nesw-resize" }
                                                            : dir === "nw"
                                                            ? { left: -4, top: -4, cursor: "nwse-resize" }
                                                            : dir === "se"
                                                            ? { right: -4, bottom: -4, cursor: "nwse-resize" }
                                                            : { left: -4, bottom: -4, cursor: "nesw-resize" }
                                                    }
                                                />
                                            ))}
                                        </>
                                    )}

                                    {dragState && dragState.handle !== "move" && (
                                        <div className="absolute left-2 bottom-2 bg-black/60 text-2xs px-2 py-1 rounded text-white pointer-events-none">
                                            {Math.round(selection.width)} x {Math.round(selection.height)}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className="px-4 py-3 rounded-xl flex items-center justify-between bg-[#0d0f14]">
                    <div className="text-xs text-fg-muted">
                        {selection ? `Selection: ${Math.round(selection.width)}x${Math.round(selection.height)}` : "Waiting for selection..."}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md bg-fill-subtle hover:bg-fill text-fg">
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={!ready}
                            className="px-3 py-1.5 text-sm rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-60"
                        >
                            Confirm
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return createPortal(panel, document.body);
}
