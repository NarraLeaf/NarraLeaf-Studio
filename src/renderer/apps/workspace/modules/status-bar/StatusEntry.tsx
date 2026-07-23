import React, { createContext, useContext } from "react";

/**
 * True while a run mode (Dev Mode / Preview / Build) is active, i.e. the whole status bar is painted
 * in the theme colour. Cells read this to switch to on-primary ink instead of the muted greys they
 * use over the resting `bg-surface-sunken`. Provided by {@link StatusBar}.
 */
export const StatusBarRunningContext = createContext(false);

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
    const running = useContext(StatusBarRunningContext);
    // The tint change eases over 300ms to match the whole-bar transition in StatusBar, so the ink
    // and the background arrive together rather than the text snapping ahead of the wash.
    const tone = running
        ? `${emphasis ? "text-on-primary" : "text-on-primary/85"} ${
            onClick ? "cursor-default hover:bg-white/15 hover:text-on-primary" : ""
        }`
        : `${emphasis ? "text-fg-muted" : "text-fg-subtle"} ${
            onClick ? "cursor-default hover:bg-fill hover:text-fg" : ""
        }`;
    const className = `flex h-full items-center gap-1.5 px-2 text-2xs transition-colors duration-300 ${tone}`;
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
