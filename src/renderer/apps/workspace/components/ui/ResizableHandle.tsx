import React, { useRef, useEffect, useState } from "react";

interface ResizableHandleProps {
    direction: "horizontal" | "vertical";
    onResize: (delta: number) => boolean;
    className?: string;
}

/**
 * Resizable handle component
 * Allows dragging to resize adjacent panels
 */
export function ResizableHandle({ direction, onResize, className = "" }: ResizableHandleProps) {
    const [isDragging, setIsDragging] = useState(false);
    const startPosRef = useRef<number>(0);

    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            const currentPos = direction === "horizontal" ? e.clientX : e.clientY;
            const delta = currentPos - startPosRef.current;

            const didResize = onResize(delta);
            if (didResize) {
                startPosRef.current = currentPos;
            }
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

    const cursorClass = direction === "horizontal" ? "cursor-col-resize" : "cursor-row-resize";
    const hoverClass = direction === "horizontal" 
        ? "hover:border-r-blue-500" 
        : "hover:border-t-blue-500";
    const activeClass = isDragging 
        ? (direction === "horizontal" ? "border-r-blue-500" : "border-t-blue-500")
        : "";

    return (
        <div
            className={`${cursorClass} ${hoverClass} ${activeClass} ${className} transition-colors select-none`}
            onMouseDown={handleMouseDown}
            style={{
                userSelect: "none",
            }}
        />
    );
}

