import React from "react";
import { cn } from "../../utils/cn";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
    content: React.ReactNode;
    side?: TooltipSide;
    children: React.ReactNode;
    className?: string;
}

const sidePos: Record<TooltipSide, string> = {
    top: "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
    bottom: "top-full left-1/2 mt-1.5 -translate-x-1/2",
    left: "right-full top-1/2 mr-1.5 -translate-y-1/2",
    right: "left-full top-1/2 ml-1.5 -translate-y-1/2",
};

/**
 * Lightweight CSS hover/focus tooltip — a themed replacement for the native
 * `title=` attribute. Note: renders in-flow (no portal), so avoid inside
 * `overflow-hidden` containers that would clip it; use {@link HintPopover} there.
 */
export function Tooltip({ content, side = "top", children, className }: TooltipProps) {
    return (
        <span className="group/tooltip relative inline-flex">
            {children}
            <span
                role="tooltip"
                className={cn(
                    "pointer-events-none absolute z-50 hidden whitespace-nowrap rounded-md border border-edge bg-surface-overlay px-2 py-1 text-2xs text-fg shadow-lg",
                    "opacity-0 transition-opacity duration-100 group-hover/tooltip:block group-hover/tooltip:opacity-100 group-focus-within/tooltip:block group-focus-within/tooltip:opacity-100",
                    sidePos[side],
                    className,
                )}
            >
                {content}
            </span>
        </span>
    );
}
