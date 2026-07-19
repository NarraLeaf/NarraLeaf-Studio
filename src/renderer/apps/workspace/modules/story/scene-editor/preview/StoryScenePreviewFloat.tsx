import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { StoryScenePreviewPane } from "./StoryScenePreviewPane";
import type { StoryScenePreviewController } from "./useStoryScenePreviewController";
import {
    STORY_PREVIEW_FLOAT_MIN_HEIGHT,
    STORY_PREVIEW_FLOAT_MIN_WIDTH,
    type StoryScenePreviewFloatRect,
} from "./storyScenePreviewSessionStore";

type Corner = "nw" | "ne" | "sw" | "se";
type Bounds = { width: number; height: number };
type Interaction = { kind: "move" } | { kind: "resize"; corner: Corner };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function readBounds(el: HTMLElement | null): Bounds | null {
    if (!el || el.clientWidth < 1 || el.clientHeight < 1) {
        return null;
    }
    return { width: el.clientWidth, height: el.clientHeight };
}

/** Fit a rect inside the container while respecting the minimum window size. */
function clampRect(rect: StoryScenePreviewFloatRect, bounds: Bounds): StoryScenePreviewFloatRect {
    const width = clamp(rect.width, STORY_PREVIEW_FLOAT_MIN_WIDTH, Math.max(STORY_PREVIEW_FLOAT_MIN_WIDTH, bounds.width));
    const height = clamp(rect.height, STORY_PREVIEW_FLOAT_MIN_HEIGHT, Math.max(STORY_PREVIEW_FLOAT_MIN_HEIGHT, bounds.height));
    return {
        width,
        height,
        x: clamp(rect.x, 0, Math.max(0, bounds.width - width)),
        y: clamp(rect.y, 0, Math.max(0, bounds.height - height)),
    };
}

/** Resize by dragging a corner: the two adjacent edges follow the pointer, the opposite corner stays put. */
function resizeRect(start: StoryScenePreviewFloatRect, corner: Corner, dx: number, dy: number, bounds: Bounds): StoryScenePreviewFloatRect {
    const right = start.x + start.width;
    const bottom = start.y + start.height;
    let { x, y, width, height } = start;

    if (corner === "nw" || corner === "sw") {
        const newX = clamp(start.x + dx, 0, right - STORY_PREVIEW_FLOAT_MIN_WIDTH);
        x = newX;
        width = right - newX;
    } else {
        const newRight = clamp(right + dx, start.x + STORY_PREVIEW_FLOAT_MIN_WIDTH, bounds.width);
        width = newRight - start.x;
    }

    if (corner === "nw" || corner === "ne") {
        const newY = clamp(start.y + dy, 0, bottom - STORY_PREVIEW_FLOAT_MIN_HEIGHT);
        y = newY;
        height = bottom - newY;
    } else {
        const newBottom = clamp(bottom + dy, start.y + STORY_PREVIEW_FLOAT_MIN_HEIGHT, bounds.height);
        height = newBottom - start.y;
    }

    return { x, y, width, height };
}

/**
 * The live-preview pane popped out as a picture-in-picture window, floating over the editor body.
 *
 * Drag the header or any edge to move it; drag a corner to resize. Two geometries are tracked: the
 * persisted "desired" rect (only ever changed by an explicit drag/resize) and the rendered rect
 * (the desired rect clamped to the container's *current* size). Keeping them separate means a
 * transient small layout — e.g. while the editor is restoring on reload — clamps only what's drawn
 * and can never corrupt the saved placement; the window re-expands once the body regains its size.
 *
 * Geometry lives locally so dragging re-renders only this small shell (never the whole editor), and
 * the embedded NLR game instance is preserved across moves/resizes. Settled geometry flows back to
 * the parent for persistence on pointer-up.
 */
export function StoryScenePreviewFloat(props: {
    controller: StoryScenePreviewController;
    containerRef: { readonly current: HTMLElement | null };
    initialRect: StoryScenePreviewFloatRect;
    onClose: () => void;
    onToggleDock: () => void;
    onCommit: (rect: StoryScenePreviewFloatRect) => void;
}) {
    const { controller, containerRef, initialRect, onClose, onToggleDock, onCommit } = props;

    const [desired, setDesired] = useState<StoryScenePreviewFloatRect>(initialRect);
    const [bounds, setBounds] = useState<Bounds | null>(() => readBounds(containerRef.current));
    const teardownRef = useRef<(() => void) | null>(null);

    const rendered = bounds ? clampRect(desired, bounds) : desired;
    const renderedRef = useRef(rendered);
    renderedRef.current = rendered;

    // Track the editor body's size so the window stays visible when it (or the app window) resizes.
    // This only feeds the render-time clamp — it never writes back to `desired`.
    useEffect(() => {
        const el = containerRef.current;
        if (!el || typeof ResizeObserver === "undefined") {
            return;
        }
        const observer = new ResizeObserver(() => {
            const next = readBounds(el);
            setBounds(prev => {
                if (!next) {
                    return prev;
                }
                return prev && prev.width === next.width && prev.height === next.height ? prev : next;
            });
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [containerRef]);

    // Drop any in-flight document listeners if the window unmounts mid-drag.
    useEffect(() => () => teardownRef.current?.(), []);

    const beginInteraction = useCallback((event: ReactPointerEvent, interaction: Interaction) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        teardownRef.current?.();

        const startX = event.clientX;
        const startY = event.clientY;
        const startRect = renderedRef.current;

        const handleMove = (moveEvent: PointerEvent) => {
            const liveBounds = readBounds(containerRef.current);
            if (!liveBounds) {
                return;
            }
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            if (interaction.kind === "move") {
                setDesired({
                    ...startRect,
                    x: clamp(startRect.x + dx, 0, Math.max(0, liveBounds.width - startRect.width)),
                    y: clamp(startRect.y + dy, 0, Math.max(0, liveBounds.height - startRect.height)),
                });
            } else {
                setDesired(resizeRect(startRect, interaction.corner, dx, dy, liveBounds));
            }
        };

        const teardown = () => {
            document.removeEventListener("pointermove", handleMove);
            document.removeEventListener("pointerup", handleUp);
            document.removeEventListener("pointercancel", handleUp);
            teardownRef.current = null;
        };
        const handleUp = () => {
            teardown();
            onCommit(renderedRef.current);
        };

        teardownRef.current = teardown;
        document.addEventListener("pointermove", handleMove);
        document.addEventListener("pointerup", handleUp);
        document.addEventListener("pointercancel", handleUp);
    }, [containerRef, onCommit]);

    const startMove = useCallback((event: ReactPointerEvent) => beginInteraction(event, { kind: "move" }), [beginInteraction]);
    const startResize = useCallback(
        (corner: Corner) => (event: ReactPointerEvent) => beginInteraction(event, { kind: "resize", corner }),
        [beginInteraction],
    );

    // Thin strips along each edge (inset to leave the corners free) drag-to-move.
    const edgeClass = "absolute cursor-move";
    // Corner squares drag-to-resize; NW/SE share one diagonal cursor, NE/SW the other.
    const cornerClass = "absolute h-3 w-3";

    return (
        <div
            className="absolute z-30 flex flex-col overflow-hidden rounded-lg border border-edge bg-surface-overlay shadow-2xl"
            style={{ left: rendered.x, top: rendered.y, width: rendered.width, height: rendered.height }}
        >
            <StoryScenePreviewPane
                controller={controller}
                onClose={onClose}
                mode="float"
                onToggleFloat={onToggleDock}
                onHeaderPointerDown={startMove}
            />

            {/* Edge move zones (corners left free for resizing). */}
            <div className={`${edgeClass} inset-x-3 top-0 h-1.5`} style={{ touchAction: "none" }} onPointerDown={startMove} />
            <div className={`${edgeClass} inset-x-3 bottom-0 h-1.5`} style={{ touchAction: "none" }} onPointerDown={startMove} />
            <div className={`${edgeClass} inset-y-3 left-0 w-1.5`} style={{ touchAction: "none" }} onPointerDown={startMove} />
            <div className={`${edgeClass} inset-y-3 right-0 w-1.5`} style={{ touchAction: "none" }} onPointerDown={startMove} />

            {/* Corner resize handles. */}
            <div className={`${cornerClass} left-0 top-0 cursor-nwse-resize`} style={{ touchAction: "none" }} onPointerDown={startResize("nw")} />
            <div className={`${cornerClass} right-0 top-0 cursor-nesw-resize`} style={{ touchAction: "none" }} onPointerDown={startResize("ne")} />
            <div className={`${cornerClass} left-0 bottom-0 cursor-nesw-resize`} style={{ touchAction: "none" }} onPointerDown={startResize("sw")} />
            <div className={`${cornerClass} right-0 bottom-0 cursor-nwse-resize`} style={{ touchAction: "none" }} onPointerDown={startResize("se")}>
                <div className="pointer-events-none absolute bottom-1 right-1 h-2 w-2 rounded-[1px] border-b-2 border-r-2 border-fg-subtle/60" />
            </div>
        </div>
    );
}
