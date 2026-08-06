import React from "react";
import { cn } from "../../utils/cn";
import { CONTROL_SQUARE_CLASS, type ControlSize } from "./controlSize";

export type ToolbarButtonSize = "xs" | ControlSize;

export interface ToolbarButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
    size?: ToolbarButtonSize;
    /** Pressed / selected state (e.g. an active formatting toggle). */
    active?: boolean;
    /** Draw a hairline border (some toolbars use bordered controls). */
    bordered?: boolean;
    "aria-label": string;
}

/**
 * `sm`/`md`/`lg` are the shared control scale (28/36/40px), so a toolbar button
 * named `md` is exactly as tall as a `Button`, `Input` or `Select` named `md`.
 * They used to be one step apart - `md` here meant 32px and `md` there meant
 * 36px - which is how a toolbar ended up with two heights in it.
 *
 * `xs` is the one step below the shared scale, for strips too dense for `sm`.
 */
const sizeStyles: Record<ToolbarButtonSize, string> = {
    xs: "h-6 w-6",
    ...CONTROL_SQUARE_CLASS,
};

/**
 * Square icon button for toolbars and panel headers. Canonicalizes the
 * `grid place-items-center rounded text-gray-400 hover:bg-white/10 hover:text-white`
 * pattern that was hand-rolled at 20+ sites with divergent size/radius/shade.
 */
export function ToolbarButton({
    size = "md",
    active = false,
    bordered = false,
    className,
    ...props
}: ToolbarButtonProps) {
    return (
        <button
            type="button"
            className={cn(
                "grid place-items-center rounded-md transition-colors cursor-default",
                "focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed",
                bordered && "border border-edge",
                active ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                sizeStyles[size],
                className,
            )}
            {...props}
        />
    );
}
