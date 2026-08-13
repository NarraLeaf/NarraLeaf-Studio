import React from "react";
import { cn } from "../../utils/cn";
import { TOOLTIP_ATTRIBUTE, TOOLTIP_SIDE_ATTRIBUTE, type TooltipSide } from "@/lib/tooltip";

export interface TooltipProps {
    /** The words on hover. Newlines break lines; an empty string means no tooltip. */
    content: string;
    /** Which way it opens. Omitted, it opens above and flips below when there is no room. */
    side?: TooltipSide;
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
 * `side` is a preference, not a guarantee: a tooltip with no room on the side it asked for opens on
 * the opposite one rather than off the edge of the window.
 */
export function Tooltip({ content, side, children, className }: TooltipProps) {
    const attributes: Record<string, string | undefined> = { [TOOLTIP_ATTRIBUTE]: content || undefined };
    if (side) {
        attributes[TOOLTIP_SIDE_ATTRIBUTE] = side;
    }
    return (
        <span {...attributes} className={cn("inline-flex", className)}>
            {children}
        </span>
    );
}
