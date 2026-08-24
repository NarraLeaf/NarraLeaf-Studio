import React, { useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import {
    EDITOR_DEFAULT_SPLIT_RATIO,
    EDITOR_SASH_SIZE,
    nudgeSplitRatio,
    resolveSplitRatio,
} from "./editorSplitResize";

/** px a single arrow key press moves a focused sash. */
const KEYBOARD_STEP_PX = 24;

/**
 * The gutter between two panes, and the drag that moves it.
 *
 * Extracted from the editor layout because a second surface now splits itself the same way - the
 * comparison tab, whose two halves are one document at two versions. The alternative was a second
 * sash with its own grab area, its own keyboard step and its own idea of how far a pane may be
 * squeezed, which is how one interface ends up with two behaviours for one control.
 *
 * **It holds no ratio.** The caller does, because the two callers keep it in different places: the
 * editor layout commits to the workspace store and restores across sessions, and the comparison tab
 * keeps it in local state for as long as the tab is open. `onPreview` fires on every pointer move
 * and `onCommit` once on release, so a caller with an expensive write has somewhere to put it.
 */
export interface SplitSashProps {
    readonly orientation: "horizontal" | "vertical";
    /** The leading pane's current share, 0-1. What a drag starts from and what the label reports. */
    readonly ratio: number;
    /** The element the ratio is measured against. Its size is read on every move. */
    readonly containerRef: React.RefObject<HTMLElement | null>;
    /** Every frame of a drag. Cheap by contract: it runs dozens of times a second. */
    readonly onPreview: (ratio: number) => void;
    /** Once, on release - and on a keyboard step, which has no drag to preview. */
    readonly onCommit: (ratio: number) => void;
    /** Whether a drag is in progress, so the gutter can show it. The caller knows; this does not. */
    readonly dragging: boolean;
    readonly label: string;
}

export function SplitSash({
    orientation,
    ratio,
    containerRef,
    onPreview,
    onCommit,
    dragging,
    label,
}: SplitSashProps) {
    const isHorizontal = orientation === "horizontal";

    const containerSize = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
            return 0;
        }
        return isHorizontal ? rect.width : rect.height;
    }, [containerRef, isHorizontal]);

    const handlePointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (e.button !== 0) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const sash = e.currentTarget;
            sash.setPointerCapture(e.pointerId);

            // The pointer keeps its grab offset within the sash, so the gutter tracks the cursor
            // instead of jumping to centre itself under it on the first move.
            const sashRect = sash.getBoundingClientRect();
            const grabOffset = isHorizontal
                ? e.clientX - (sashRect.left + sashRect.width / 2)
                : e.clientY - (sashRect.top + sashRect.height / 2);

            // A drag that leaves the sash would otherwise select text and flip the cursor over
            // whatever it passes; both are pinned for the duration.
            const previousCursor = document.body.style.cursor;
            const previousUserSelect = document.body.style.userSelect;
            document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
            document.body.style.userSelect = "none";

            let latest = ratio;

            const onMove = (moveEvent: PointerEvent) => {
                const rect = containerRef.current?.getBoundingClientRect();
                if (!rect) {
                    return;
                }
                const size = isHorizontal ? rect.width : rect.height;
                const offset = isHorizontal
                    ? moveEvent.clientX - rect.left - grabOffset
                    : moveEvent.clientY - rect.top - grabOffset;
                latest = resolveSplitRatio(size, offset);
                onPreview(latest);
            };

            const onUp = () => {
                sash.removeEventListener("pointermove", onMove);
                sash.removeEventListener("pointerup", onUp);
                sash.removeEventListener("pointercancel", onUp);
                document.body.style.cursor = previousCursor;
                document.body.style.userSelect = previousUserSelect;
                onCommit(latest);
            };

            sash.addEventListener("pointermove", onMove);
            sash.addEventListener("pointerup", onUp);
            sash.addEventListener("pointercancel", onUp);
        },
        [containerRef, isHorizontal, onCommit, onPreview, ratio],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            const decrease = isHorizontal ? "ArrowLeft" : "ArrowUp";
            const increase = isHorizontal ? "ArrowRight" : "ArrowDown";
            if (e.key !== decrease && e.key !== increase) {
                return;
            }
            e.preventDefault();
            const delta = e.key === increase ? KEYBOARD_STEP_PX : -KEYBOARD_STEP_PX;
            onCommit(nudgeSplitRatio(ratio, containerSize(), delta));
        },
        [containerSize, isHorizontal, onCommit, ratio],
    );

    return (
        <div
            role="separator"
            tabIndex={0}
            aria-orientation={isHorizontal ? "vertical" : "horizontal"}
            aria-valuenow={Math.round(ratio * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={label}
            onPointerDown={handlePointerDown}
            onDoubleClick={() => onCommit(EDITOR_DEFAULT_SPLIT_RATIO)}
            onKeyDown={handleKeyDown}
            style={{ flex: `0 0 ${EDITOR_SASH_SIZE}px` }}
            className={cn(
                "relative z-10 outline-none transition-colors duration-100",
                isHorizontal ? "cursor-col-resize" : "cursor-row-resize",
                dragging ? "bg-primary" : "bg-edge hover:bg-primary/50 focus:bg-primary/50",
            )}
        >
            {/*
              * Invisible grab extender: reaches past the 4px gutter into both panes so the sash
              * is easy to hit. It carries no highlight of its own - hovering it puts THIS div
              * into :hover, so only the gutter line (this div's 4px box) recolors. The highlight
              * therefore tracks the visible line, not the wider grab area.
              */}
            <span
                className={cn(
                    "absolute",
                    isHorizontal ? "-left-1 -right-1 inset-y-0" : "-top-1 -bottom-1 inset-x-0",
                )}
                aria-hidden
            />
        </div>
    );
}
