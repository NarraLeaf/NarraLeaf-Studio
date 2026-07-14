import React from "react";
import { cn } from "../../utils/cn";

export interface EmptyStateProps {
    icon?: React.ReactNode;
    title?: React.ReactNode;
    description?: React.ReactNode;
    action?: React.ReactNode;
    size?: "sm" | "md";
    className?: string;
}

/**
 * Centered "nothing here" placeholder. Replaces one-off
 * `text-center text-xs text-fg-subtle` empty rows with a consistent block.
 */
export function EmptyState({ icon, title, description, action, size = "md", className }: EmptyStateProps) {
    return (
        <div
            className={cn(
                "flex flex-col items-center justify-center gap-2 text-center text-fg-subtle",
                size === "sm" ? "p-4" : "p-8",
                className,
            )}
        >
            {icon && <div className="opacity-70">{icon}</div>}
            {title && <p className="text-sm font-medium text-fg-muted">{title}</p>}
            {description && <p className="max-w-xs text-xs text-fg-subtle">{description}</p>}
            {action && <div className="mt-1">{action}</div>}
        </div>
    );
}
