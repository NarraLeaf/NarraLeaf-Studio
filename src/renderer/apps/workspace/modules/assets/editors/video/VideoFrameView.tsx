import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { TRANSPARENCY_BACKDROP } from "@/lib/vcs/presenters/bitmapPreview";
import { cn } from "@/lib/utils/cn";
import { canPan, FIT_VIEW, panBy, resolveView, zoomAt, zoomTo, type FrameView, type Size } from "./frameViewport";

interface VideoFrameViewProps {
    src: string;
    /** The picture's own size, once the element has read it; the view cannot be laid out before. */
    frameSize: Size | null;
    /** The viewport's size, measured by the editor, which needs it for the zoom menu too. */
    viewport: Size;
    view: FrameView;
    onViewChange: (view: FrameView) => void;
    /** Draw the checkerboard behind the picture - for a clip whose frames have transparent pixels. */
    transparency: boolean;
    /** The element, for the transport and the frame capture to drive. */
    videoRef: (element: HTMLVideoElement | null) => void;
    onLoadedMetadata: (element: HTMLVideoElement) => void;
    onError: () => void;
}

/**
 * The picture: the preview's `<video>` in a viewport that fits it, zooms it about the pointer and
 * pans it once it is larger than the viewport.
 *
 * Gestures only, no controls of its own - the zoom menu is in the editor's toolbar. ⌘/Ctrl+wheel (and
 * a trackpad pinch, which arrives as one) zooms; a plain wheel or a drag pans; a double-click goes
 * between the fitted view and actual pixels at the point clicked.
 */
export function VideoFrameView({
    src,
    frameSize,
    viewport,
    view,
    onViewChange,
    transparency,
    videoRef,
    onLoadedMetadata,
    onError,
}: VideoFrameViewProps) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
    const [dragging, setDragging] = useState(false);

    // The wheel has to be able to cancel the page's own scroll, which a React handler cannot.
    const latest = useRef({ view, viewport, frameSize, onViewChange });
    latest.current = { view, viewport, frameSize, onViewChange };
    useEffect(() => {
        const element = viewportRef.current;
        if (!element) {
            return;
        }
        const onWheel = (event: WheelEvent) => {
            const { view, viewport, frameSize, onViewChange } = latest.current;
            if (!frameSize) {
                return;
            }
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                const rect = element.getBoundingClientRect();
                // Proportional to the wheel distance, so a pinch's many small steps zoom smoothly and a
                // mouse wheel's notch is one comfortable step.
                const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.002));
                onViewChange(zoomAt(view, viewport, frameSize, factor, { x: event.clientX - rect.left, y: event.clientY - rect.top }));
                return;
            }
            if (canPan(view, viewport, frameSize)) {
                event.preventDefault();
                onViewChange(panBy(view, viewport, frameSize, -event.deltaX, -event.deltaY));
            }
        };
        element.addEventListener("wheel", onWheel, { passive: false });
        return () => element.removeEventListener("wheel", onWheel);
    }, []);

    const pannable = frameSize ? canPan(view, viewport, frameSize) : false;

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!pannable || event.button !== 0) {
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        setDragging(true);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId || !frameSize) {
            return;
        }
        onViewChange(panBy(view, viewport, frameSize, event.clientX - drag.x, event.clientY - drag.y));
        dragRef.current = { ...drag, x: event.clientX, y: event.clientY };
    };

    const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) {
            return;
        }
        dragRef.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const handleDoubleClick = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (!frameSize) {
                return;
            }
            if (view.mode === "manual" && Math.abs(resolveView(view, viewport, frameSize).zoom - 1) < 1e-6) {
                onViewChange(FIT_VIEW);
                return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            onViewChange(zoomTo(view, viewport, frameSize, 1, { x: event.clientX - rect.left, y: event.clientY - rect.top }));
        },
        [frameSize, view, viewport, onViewChange],
    );

    const placed = frameSize && viewport.width > 0 && viewport.height > 0 ? resolveView(view, viewport, frameSize) : null;
    const pictureStyle: CSSProperties = placed && frameSize
        ? {
            left: placed.x,
            top: placed.y,
            width: frameSize.width * placed.zoom,
            height: frameSize.height * placed.zoom,
            // Past 2x the author is looking at pixels, and smoothing would blur the very thing they zoomed
            // in to see.
            imageRendering: placed.zoom >= 2 ? "pixelated" : "auto",
            ...(transparency ? TRANSPARENCY_BACKDROP : {}),
        }
        : { visibility: "hidden" };

    return (
        <div
            ref={viewportRef}
            className={cn(
                "relative h-full w-full touch-none select-none overflow-hidden",
                pannable ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default",
            )}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={handleDoubleClick}
        >
            <video
                ref={videoRef}
                src={src}
                preload="auto"
                playsInline
                className="absolute block max-w-none"
                style={pictureStyle}
                onLoadedMetadata={event => onLoadedMetadata(event.currentTarget)}
                onError={onError}
            />
        </div>
    );
}
