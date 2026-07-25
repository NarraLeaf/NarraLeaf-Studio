import React, { useRef, useEffect, useState } from "react";

interface ResizableHandleProps {
    direction: "horizontal" | "vertical";
    onResize: (delta: number) => number;
    className?: string;
}

/**
 * The seam between two dock regions: one 1px line, and the drag target for resizing them.
 *
 * The line is the ONLY thing painted at the seam — the panels on either side draw no border of
 * their own, so there is no second line and no strip of a third surface colour between them
 * (that strip used to read as a gap, and picked up the wrong contrast against panel headers and
 * a custom workspace background). Its grab area and its hover glow are both pseudo-elements
 * that spill past the 1px box without occupying layout — see `.nl-dock-divider` in styles.css.
 */
export function ResizableHandle({ direction, onResize, className = "" }: ResizableHandleProps) {
    const [isDragging, setIsDragging] = useState(false);
    const startPosRef = useRef<number>(0);

    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            const currentPos = direction === "horizontal" ? e.clientX : e.clientY;
            const delta = currentPos - startPosRef.current;

            const result = onResize(delta);
            startPosRef.current = currentPos + result;
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isDragging, direction, onResize]);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        startPosRef.current = direction === "horizontal" ? e.clientX : e.clientY;
        setIsDragging(true);
    };

    const axisClass = direction === "horizontal" ? "nl-dock-divider--x" : "nl-dock-divider--y";

    return (
        <div
            role="separator"
            aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
            className={`nl-dock-divider ${axisClass}${isDragging ? " nl-dock-divider--active" : ""} ${className}`.trim()}
            onMouseDown={handleMouseDown}
        />
    );
}
