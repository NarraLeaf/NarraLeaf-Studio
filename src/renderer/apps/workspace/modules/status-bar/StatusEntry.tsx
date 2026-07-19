import React from "react";

/**
 * One cell in the status bar. Entries render at most a small icon plus a short label; anything
 * longer belongs in a panel. Passing `onClick` turns the cell into a button (hover highlight
 * included), otherwise it is inert text.
 */
export function StatusEntry({
    onClick,
    title,
    children,
    emphasis = false,
}: {
    onClick?: () => void;
    title?: string;
    children: React.ReactNode;
    emphasis?: boolean;
}) {
    const className = `flex h-full items-center gap-1.5 px-2 text-2xs ${
        emphasis ? "text-fg-muted" : "text-fg-subtle"
    } ${onClick ? "cursor-default transition-colors hover:bg-fill hover:text-fg" : ""}`;
    if (!onClick) {
        return (
            <span className={className} title={title}>
                {children}
            </span>
        );
    }
    return (
        <button type="button" onClick={onClick} title={title} className={className}>
            {children}
        </button>
    );
}
