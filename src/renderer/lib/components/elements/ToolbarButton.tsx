import React from "react";
import { cn } from "../../utils/cn";

export type ToolbarButtonSize = "xs" | "sm" | "md" | "lg";

export interface ToolbarButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
    size?: ToolbarButtonSize;
    /** Pressed / selected state (e.g. an active formatting toggle). */
    active?: boolean;
    /** Draw a hairline border (some toolbars use bordered controls). */
    bordered?: boolean;
    "aria-label": string;
}

const sizeStyles: Record<ToolbarButtonSize, string> = {
    xs: "h-6 w-6",
    sm: "h-7 w-7",
    md: "h-8 w-8",
    lg: "h-9 w-9",
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
