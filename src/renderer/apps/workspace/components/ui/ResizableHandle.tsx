import React, { useRef, useEffect, useState } from "react";

interface ResizableHandleProps {
    direction: "horizontal" | "vertical";
    onResize: (delta: number) => number;
    className?: string;
    /** Called when a drag begins, before the first `onResize`. */
    onDragStart?: () => void;
    /** Called when the button is released, after the last `onResize` - where a size is worth saving. */
    onDragEnd?: () => void;
    /**
     * Makes the seam a keyboard control: it takes focus, and the arrow keys along its axis move it
     * this many pixels. A key press is reported as a drag of one step - `onDragStart`, one
     * `onResize`, `onDragEnd` - so a caller that saves on release saves a key press the same way.
     * Without it the seam is pointer-only, which is what the workspace's own docks are.
     */
    keyboardStep?: number;
    /** Double-click puts the two sides back to the sizes they started at. */
    onReset?: () => void;
    /** What a screen reader calls the seam; needed once it can take focus. */
    label?: string;
    /** The leading side's share of the two, 0-100, for a seam that can take focus. */
    valueNow?: number;
}

/**
 * The seam between two dock regions: one 1px line, and the drag target for resizing them.
 *
 * The line is the ONLY thing painted at the seam — the panels on either side draw no border of
 * their own, so there is no second line and no strip of a third surface colour between them
 * (that strip used to read as a gap, and picked up the wrong contrast against panel headers and
 * a custom workspace background). Its grab area and its hover glow are both pseudo-elements
 * that spill past the 1px box without occupying layout — see `.nl-dock-divider` in styles.css.
 *
 * The drag is followed on the document the handle is drawn in, which is not the renderer's own when
 * the handle is inside a detached editor window: listening on the opener's document there would hear
 * no movement at all and leave the drag stuck on.
 */
export function ResizableHandle({
    direction,
    onResize,
    className = "",
    onDragStart,
    onDragEnd,
    keyboardStep,
    onReset,
    label,
    valueNow,
}: ResizableHandleProps) {
    const [dragDocument, setDragDocument] = useState<Document | null>(null);
    const isDragging = dragDocument !== null;
    const startPosRef = useRef<number>(0);
    const onDragEndRef = useRef(onDragEnd);
    onDragEndRef.current = onDragEnd;

    useEffect(() => {
        if (!dragDocument) return;

        const handleMouseMove = (e: MouseEvent) => {
            const currentPos = direction === "horizontal" ? e.clientX : e.clientY;
            const delta = currentPos - startPosRef.current;

            const result = onResize(delta);
            startPosRef.current = currentPos + result;
        };

        const handleMouseUp = () => {
            setDragDocument(null);
            onDragEndRef.current?.();
        };

        dragDocument.addEventListener("mousemove", handleMouseMove);
        dragDocument.addEventListener("mouseup", handleMouseUp);

        return () => {
            dragDocument.removeEventListener("mousemove", handleMouseMove);
            dragDocument.removeEventListener("mouseup", handleMouseUp);
        };
    }, [dragDocument, direction, onResize]);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        startPosRef.current = direction === "horizontal" ? e.clientX : e.clientY;
        onDragStart?.();
        setDragDocument(e.currentTarget.ownerDocument);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (keyboardStep === undefined) {
            return;
        }
        const decrease = direction === "horizontal" ? "ArrowLeft" : "ArrowUp";
        const increase = direction === "horizontal" ? "ArrowRight" : "ArrowDown";
        if (e.key !== decrease && e.key !== increase) {
            return;
        }
        e.preventDefault();
        onDragStart?.();
        onResize(e.key === increase ? keyboardStep : -keyboardStep);
        onDragEnd?.();
    };

    const focusable = keyboardStep !== undefined;
    const axisClass = direction === "horizontal" ? "nl-dock-divider--x" : "nl-dock-divider--y";

    return (
        <div
            role="separator"
            aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
            aria-label={label}
            aria-valuenow={focusable && valueNow !== undefined ? Math.round(valueNow) : undefined}
            aria-valuemin={focusable && valueNow !== undefined ? 0 : undefined}
            aria-valuemax={focusable && valueNow !== undefined ? 100 : undefined}
            tabIndex={focusable ? 0 : undefined}
            className={`nl-dock-divider ${axisClass}${isDragging ? " nl-dock-divider--active" : ""} ${className}`.trim()}
            onMouseDown={handleMouseDown}
            onKeyDown={focusable ? handleKeyDown : undefined}
            onDoubleClick={onReset}
        />
    );
}
