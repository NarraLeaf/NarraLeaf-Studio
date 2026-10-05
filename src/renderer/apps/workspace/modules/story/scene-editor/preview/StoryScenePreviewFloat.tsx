import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { StoryScenePreviewPane } from "./StoryScenePreviewPane";
import type { StoryScenePreviewController } from "./useStoryScenePreviewController";
import type { StoryScenePreviewFloatRect } from "./storyScenePreviewSessionStore";
import {
    clampStoryPreviewFloatRect,
    moveStoryPreviewFloatRect,
    resizeStoryPreviewFloatRect,
    type StoryPreviewFloatBounds,
    type StoryPreviewFloatCorner,
} from "./storyPreviewFloatGeometry";

type Interaction = { kind: "move" } | { kind: "resize"; corner: StoryPreviewFloatCorner };

/**
 * The live-preview pane popped out as a picture-in-picture window, floating over the workspace.
 *
 * Drag the header or any edge to move it; drag a corner to resize. Two geometries are tracked: the
 * "desired" rect (the stored placement, changed only by an explicit drag or resize) and the rendered
 * rect (the desired rect clamped to the area's *current* size). Keeping them separate means a
 * transient small layout - the window shrunk for a moment, the workspace still restoring - clamps
 * only what is drawn and never corrupts the saved placement; the window grows back once the room
 * returns.
 *
 * Geometry lives locally so dragging re-renders only this small shell, and the embedded NLR game is
 * kept across moves and resizes. The settled rect goes back to the host for persistence on
 * pointer-up.
 */
export function StoryScenePreviewFloat(props: {
    controller: StoryScenePreviewController;
    /** The area the window floats over, or null while it is not laid out. */
    bounds: StoryPreviewFloatBounds | null;
    rect: StoryScenePreviewFloatRect;
    /** The scene on the stage, named in the header: the window outlives the tab it shows. */
    sceneName: string | null;
    onClose: () => void;
    onDock: () => void;
    onCommit: (rect: StoryScenePreviewFloatRect) => void;
}) {
    const { controller, bounds, rect, sceneName, onClose, onDock, onCommit } = props;

    const [desired, setDesired] = useState<StoryScenePreviewFloatRect>(rect);
    const teardownRef = useRef<(() => void) | null>(null);
    // A stored rect that changes under the window (carried over from an older build, written by the
    // host) replaces the local one, unless the author is in the middle of moving it. Compared by
    // value: the host hands over a fresh object whenever it re-renders.
    const { x, y, width, height } = rect;
    useEffect(() => {
        if (!teardownRef.current) {
            setDesired(current => (
                current.x === x && current.y === y && current.width === width && current.height === height
                    ? current
                    : { x, y, width, height }
            ));
        }
    }, [x, y, width, height]);

    const rendered = bounds ? clampStoryPreviewFloatRect(desired, bounds) : desired;
    // What a drag starts from and is bounded by: the committed rect and area, read by the pointer
    // handlers between renders.
    const renderedRef = useRef(rendered);
    const boundsRef = useRef(bounds);
    useLayoutEffect(() => {
        renderedRef.current = rendered;
        boundsRef.current = bounds;
    });

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
            const liveBounds = boundsRef.current;
            if (!liveBounds) {
                return;
            }
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            setDesired(interaction.kind === "move"
                ? moveStoryPreviewFloatRect(startRect, dx, dy, liveBounds)
                : resizeStoryPreviewFloatRect(startRect, interaction.corner, dx, dy, liveBounds));
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
    }, [onCommit]);

    const startMove = useCallback((event: ReactPointerEvent) => beginInteraction(event, { kind: "move" }), [beginInteraction]);
    const startResize = useCallback(
        (corner: StoryPreviewFloatCorner) => (event: ReactPointerEvent) => beginInteraction(event, { kind: "resize", corner }),
        [beginInteraction],
    );

    // Thin strips along each edge (inset to leave the corners free) drag-to-move.
    const edgeClass = "absolute cursor-move";
    // Corner squares drag-to-resize; NW/SE share one diagonal cursor, NE/SW the other.
    const cornerClass = "absolute h-3 w-3";

    return (
        <div
            className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-lg border border-edge bg-surface-overlay shadow-2xl"
            style={{ left: rendered.x, top: rendered.y, width: rendered.width, height: rendered.height }}
            data-story-preview-float=""
        >
            <StoryScenePreviewPane
                controller={controller}
                onClose={onClose}
                mode="float"
                sceneName={sceneName}
                onToggleFloat={onDock}
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
                <div className="pointer-events-none absolute bottom-1 right-1 h-2 w-2 rounded-sm border-b-2 border-r-2 border-fg-subtle/60" />
            </div>
        </div>
    );
}
