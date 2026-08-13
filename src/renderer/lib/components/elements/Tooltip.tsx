import React from "react";
import { cn } from "../../utils/cn";
import { TOOLTIP_ATTRIBUTE } from "@/lib/tooltip";

export interface TooltipProps {
    /** The words on hover. Newlines break lines; an empty string means no tooltip. */
    content: string;
    children: React.ReactNode;
    className?: string;
}

/**
 * A tooltip for a target that cannot carry the attribute itself.
 *
 * The usual way to give something a tooltip is `data-tip="..."` on the element, which needs no
 * wrapper and no import - see `lib/tooltip`. This exists for the case where the element is drawn by
 * a component that does not pass its rest props through, so there is nowhere to put the attribute.
 * It draws an inline-flex span, which is a layout change, so prefer the attribute wherever the
 * target will take it.
 *
 * There is no `side`: placement is decided against the window edges when the tooltip is drawn.
 */
export function Tooltip({ content, children, className }: TooltipProps) {
    const attributes = { [TOOLTIP_ATTRIBUTE]: content || undefined };
    return (
        <span {...attributes} className={cn("inline-flex", className)}>
            {children}
        </span>
    );
}
