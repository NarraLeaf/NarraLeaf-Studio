import React from "react";
import { cn } from "../../utils/cn";

export interface PanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
    size?: "sm" | "md" | "lg";
    children: React.ReactNode;
}

const sizeStyles = {
    sm: "min-h-[36px]",
    md: "min-h-[44px]",
    lg: "h-12",
};

/**
 * Standard panel / editor header row. Canonicalizes the
 * `flex items-center gap-2 border-b border-edge px-3` header rows that used
 * divergent heights (36/44/48px) and paddings across editors.
 */
export function PanelHeader({ size = "md", className, children, ...props }: PanelHeaderProps) {
    return (
        <div
            className={cn(
                "flex shrink-0 items-center gap-2 border-b border-edge px-3",
                sizeStyles[size],
                className,
            )}
            {...props}
        >
            {children}
        </div>
    );
}
