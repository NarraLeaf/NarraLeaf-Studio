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
                "relative inline-flex shrink-0 items-center rounded-full border p-0 transition-colors duration-200",
                "appearance-none",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                disabled && !loading && "opacity-50 cursor-not-allowed",
                checked
                    ? "bg-primary/70 border-transparent"
                    : "bg-fill border-edge-strong hover:bg-fill-strong",
                currentSize.track,
                className,
            )}
            {...props}
        >
            <span
                className={cn(
                    "pointer-events-none absolute left-1 top-1/2 block -translate-y-1/2 rounded-full bg-fg shadow-sm transition-transform duration-200",
                    currentSize.thumb,
                    currentSize.thumbOffset,
                )}
            />
        </button>
    );
}
