import React from "react";
import { cn } from "../../utils/cn";

export type SwitchSize = "sm" | "md" | "lg";
export type SwitchVariant = "default";

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    size?: SwitchSize;
    variant?: SwitchVariant;
    disabled?: boolean;
    loading?: boolean;
}

/**
 * Switch component with VS Code-like styling
 * Provides a toggle switch with consistent design system integration
 */
export function Switch({
    checked = false,
    onCheckedChange,
    size = "md",
    variant = "default",
    disabled = false,
    loading = false,
    className = "",
    onClick,
    ...props
}: SwitchProps) {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (disabled || loading) return;
        onCheckedChange?.(!checked);
        onClick?.(e);
    };

    const sizeStyles: Record<SwitchSize, { track: string; thumb: string; thumbOffset: string }> = {
        sm: {
            track: "h-5 w-9",
            thumb: "h-3 w-3",
            thumbOffset: checked ? "translate-x-4" : "translate-x-0",
        },
        md: {
            track: "h-6 w-11",
            thumb: "h-4 w-4",
            thumbOffset: checked ? "translate-x-5" : "translate-x-0",
        },
        lg: {
            track: "h-7 w-12",
            thumb: "h-5 w-5",
            thumbOffset: checked ? "translate-x-5" : "translate-x-0",
        },
    };

    const currentSize = sizeStyles[size];

    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled || loading}
            onClick={handleClick}
            className={cn(
                "relative inline-flex shrink-0 cursor-default items-center rounded-full border p-0 transition-colors duration-200",
                "appearance-none",
                // `!`: styles.css clears the outline of every focused `<button>` with `!important`, so
                // only an important utility draws the keyboard's ring. `:focus-visible`, so a click
                // with the mouse does not light it.
                "focus-visible:!outline focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-primary",
                // Disabled keeps the two states apart instead of fading them both to the same pale
                // shape: on stays a filled accent track with a solid knob, off an empty track with a
                // faint one. A switch that is closed still says which way it is set.
                disabled && !loading
                    ? checked
                        ? "cursor-not-allowed bg-primary/45 border-transparent"
                        : "cursor-not-allowed bg-transparent border-edge"
                    : checked
                        ? "bg-primary/70 border-transparent"
                        : "bg-fill border-edge-strong hover:bg-fill-strong",
                currentSize.track,
                className,
            )}
            {...props}
        >
            <span
                className={cn(
                    "pointer-events-none absolute left-1 top-1/2 block -translate-y-1/2 rounded-full shadow-sm transition-transform duration-200",
                    disabled && !loading ? (checked ? "bg-fg/70" : "bg-fg/25") : "bg-fg",
                    currentSize.thumb,
                    currentSize.thumbOffset,
                )}
            />
        </button>
    );
}
