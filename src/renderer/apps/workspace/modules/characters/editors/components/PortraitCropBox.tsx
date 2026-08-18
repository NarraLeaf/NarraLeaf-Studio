import React, { useCallback, useEffect, useRef, useState } from "react";
import type { PortraitCrop } from "@/lib/workspace/services/character/types";

/**
 * The author's answer to "the automatic head crop framed the wrong thing".
 *
 * A dialog avatar is a square window onto a full-body sprite, and where that window sits is decided
 * by `headCrop`'s silhouette heuristic — which is right most of the time and has no recourse when it
 * is not. The model has carried a per-pose and a per-character framing rect the whole time, the
 * baker reads them and the story badges read them; nothing ever wrote one. This is the writer.
 *
 * ## Square in image pixels, not in the box
 *
 * `PortraitCrop` is normalized against the image, so a visually square crop of a 1000×2000 sprite is
 * `w: 0.2, h: 0.1` — the two numbers differ even though they describe the same number of pixels.
 * The drag keeps the box's *on-screen* shape, which (the picture being letterboxed, never stretched)
 * is the same thing as that shape in image pixels. That matters twice over for the dialog avatar:
 * the bake letterboxes a non-square crop into its square PNG, and `HeadThumbnail` stretches one.
 *
 * Which shape is {@link PortraitCropBoxProps.aspect}, and it defaults to square — the avatar case,
 * unchanged. A stage avatar frame passes its own box's ratio instead, because there the crop is
 * shown through `object-fit` and a crop of a different shape would simply be cropped again.
 *
 * ## Nothing is written until the pointer comes up
 *
 * A bake is fingerprinted over the crop (`avatarBakeFingerprint`), so writing the model per
 * pointer-move would queue a re-render of every differential for every pixel of a drag. The live box
 * is local state; `onCommit` fires once, on release.
 */

type ScreenBox = { x: number; y: number; width: number; height: number };
type DragMode = "move" | "nw" | "ne" | "sw" | "se";

/** Smallest box worth having, in CSS pixels — below this the handles overlap and it cannot be grabbed. */
const MIN_BOX_PX = 24;

/** Half the handle's own size, so it straddles the corner rather than sitting inside it. */
const HANDLE_OFFSET = -6;

const HANDLES: { mode: DragMode; cursor: string; left: number | string; top: number | string }[] = [
    { mode: "nw", cursor: "nwse-resize", left: HANDLE_OFFSET, top: HANDLE_OFFSET },
    { mode: "ne", cursor: "nesw-resize", left: `calc(100% + ${HANDLE_OFFSET}px)`, top: HANDLE_OFFSET },
    { mode: "sw", cursor: "nesw-resize", left: HANDLE_OFFSET, top: `calc(100% + ${HANDLE_OFFSET}px)` },
    { mode: "se", cursor: "nwse-resize", left: `calc(100% + ${HANDLE_OFFSET}px)`, top: `calc(100% + ${HANDLE_OFFSET}px)` },
];

/** Where the letterboxed picture actually sits inside the pane, in the pane's own coordinates. */
function imageRect(pane: { width: number; height: number }, natural: { width: number; height: number }) {
    const scale = Math.min(pane.width / natural.width, pane.height / natural.height);
    const width = natural.width * scale;
    const height = natural.height * scale;
    return { left: (pane.width - width) / 2, top: (pane.height - height) / 2, width, height };
}

export type PortraitCropBoxProps = {
    /**
     * Natural size of the picture underneath, so the box can be square in *its* pixels. Null while
     * nothing has been measured yet, in which case there is nothing to frame and nothing is drawn.
     */
    natural: { width: number; height: number } | null;
    /** The framing in force, or undefined when the automatic crop is being used. */
    value: PortraitCrop | undefined;
    /** Hover text for the box, so what the rectangle is is answerable without a caption. */
    title?: string;
    /**
     * Width ÷ height the box keeps while it is dragged, in image pixels. Defaults to 1 (square).
     * `null` lets the two edges move independently.
     */
    aspect?: number | null;
    onCommit: (crop: PortraitCrop) => void;
};

export function PortraitCropBox(props: PortraitCropBoxProps) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [pane, setPane] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
    const [live, setLive] = useState<ScreenBox | null>(null);
    const dragRef = useRef<{ mode: DragMode; pointerX: number; pointerY: number; from: ScreenBox } | null>(null);

    useEffect(() => {
        const element = rootRef.current;
        if (!element || typeof ResizeObserver === "undefined") {
            return;
        }
        const observer = new ResizeObserver(() => {
            setPane({ width: element.clientWidth, height: element.clientHeight });
        });
        observer.observe(element);
        setPane({ width: element.clientWidth, height: element.clientHeight });
        return () => observer.disconnect();
    }, []);

    const { natural, value, onCommit } = props;
    const aspect = props.aspect === undefined ? 1 : props.aspect;
    const ready = Boolean(natural && pane.width > 1 && pane.height > 1);
    const rect = ready && natural ? imageRect(pane, natural) : null;

    /** The stored crop as a screen box, or a starting suggestion when there is no stored one. */
    const committed: ScreenBox | null = rect
        ? value
            // A stored crop may not match the current shape (an older one, or one written by
            // something else); it is rendered as it is and reshaped only when the author next drags.
            ? {
                x: rect.left + value.x * rect.width,
                y: rect.top + value.y * rect.height,
                width: value.w * rect.width,
                height: value.h * rect.height,
            }
            : (() => {
                const width = Math.min(rect.width, rect.height) * 0.4;
                const height = aspect ? width / aspect : width;
                return { x: rect.left + (rect.width - width) / 2, y: rect.top + rect.height * 0.04, width, height };
            })()
        : null;
    const box = live ?? committed;

    const clamp = useCallback((next: ScreenBox): ScreenBox => {
        if (!rect) return next;
        const width = Math.max(MIN_BOX_PX, Math.min(next.width, rect.width));
        const height = Math.max(MIN_BOX_PX, Math.min(next.height, rect.height));
        return {
            width,
            height,
            x: Math.max(rect.left, Math.min(next.x, rect.left + rect.width - width)),
            y: Math.max(rect.top, Math.min(next.y, rect.top + rect.height - height)),
        };
    }, [rect?.left, rect?.top, rect?.width, rect?.height]);

    useEffect(() => {
        if (!live) {
            return;
        }
        const move = (event: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag) return;
            const dx = event.clientX - drag.pointerX;
            const dy = event.clientY - drag.pointerY;
            const from = drag.from;
            if (drag.mode === "move") {
                setLive(clamp({ ...from, x: from.x + dx, y: from.y + dy }));
                return;
            }
            // With a locked shape one scalar drives both edges: each corner reads the delta that
            // grows it, and the anchor is the opposite corner. Free-form lets the two run apart.
            const growX = drag.mode === "se" || drag.mode === "ne" ? dx : -dx;
            const growY = drag.mode === "se" || drag.mode === "sw" ? dy : -dy;
            const width = aspect
                ? Math.max(MIN_BOX_PX, from.width + Math.max(growX, growY * aspect))
                : Math.max(MIN_BOX_PX, from.width + growX);
            const height = aspect ? width / aspect : Math.max(MIN_BOX_PX, from.height + growY);
            const x = drag.mode === "ne" || drag.mode === "se" ? from.x : from.x + from.width - width;
            const y = drag.mode === "sw" || drag.mode === "se" ? from.y : from.y + from.height - height;
            setLive(clamp({ x, y, width, height }));
        };
        const up = () => {
            dragRef.current = null;
            setLive(current => {
                if (current && rect) {
                    onCommit({
                        x: (current.x - rect.left) / rect.width,
                        y: (current.y - rect.top) / rect.height,
                        w: current.width / rect.width,
                        h: current.height / rect.height,
                    });
                }
                return null;
            });
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
    }, [live !== null, aspect, clamp, onCommit, rect?.left, rect?.top, rect?.width, rect?.height]);

    const begin = (mode: DragMode) => (event: React.PointerEvent) => {
        if (!box) return;
        event.preventDefault();
        event.stopPropagation();
        dragRef.current = { mode, pointerX: event.clientX, pointerY: event.clientY, from: box };
        setLive(box);
    };

    return (
        <div ref={rootRef} className="absolute inset-0">
            {box && (
                /* Everything outside the frame is dimmed by one enormous spread shadow rather than by
                   four strips: one element cannot leave seams at the corners, and it costs no layout. */
                <div
                    className="absolute cursor-move border border-primary"
                    data-tip={props.title}
                    style={{
                        left: box.x,
                        top: box.y,
                        width: box.width,
                        height: box.height,
                        boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
                    }}
                    onPointerDown={begin("move")}
                >
                    {HANDLES.map(handle => (
                        <span
                            key={handle.mode}
                            className="absolute h-3 w-3 rounded-sm border border-primary bg-surface"
                            style={{ left: handle.left, top: handle.top, cursor: handle.cursor }}
                            onPointerDown={begin(handle.mode)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
