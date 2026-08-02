import React, { createContext, useContext } from "react";

/**
 * True while a run mode (Dev Mode / Preview / Build) is active, i.e. the whole status bar is painted
 * in the theme colour. Cells read this to switch to on-primary ink instead of the muted greys they
 * use over the resting `bg-surface-sunken`. Provided by {@link StatusBar}.
 */
export const StatusBarRunningContext = createContext(false);

/**
 * The registry id of the entry being rendered, supplied by {@link StatusBar} so that the cell can
 * label itself.
 *
 * Through a context rather than a prop because entries take no props by design (see
 * `StatusBarEntryModule`), and on the cell rather than on the wrapper for a reason that matters:
 * most entries render `null` most of the time, and an id sitting on a wrapper that is still in the
 * tree would claim a cell is on screen when nothing is. A hook that answers "present" for an empty
 * cell is worse than no hook - it is how a verification run goes green having measured a thing that
 * was never drawn.
 */
export const StatusBarEntryIdContext = createContext<string | undefined>(undefined);

/**
 * One cell in the status bar. Entries render at most a small icon plus a short label; anything
 * longer belongs in a panel. Passing `onClick` turns the cell into a button (hover highlight
 * included), otherwise it is inert text.
 *
 * `onClick` receives the mouse event because some cells open a context menu, which has to be
 * positioned at the pointer. Handlers that do not care simply ignore the argument - a `() => void`
 * is assignable here, so every existing caller and every plugin-registered `StatusBarItem.command`
 * keeps working untouched.
 */
export function StatusEntry({
    onClick,
    title,
    children,
    emphasis = false,
    tone: toneOverride,
    ariaLabel,
    dataAttributes,
}: {
    onClick?: (event: React.MouseEvent) => void;
    title?: string;
    children: React.ReactNode;
    emphasis?: boolean;
    /**
     * A tailwind text-colour class that replaces the cell's resting ink, for a value that is
     * *wrong* rather than merely notable - today only the text editor's encoding token, which turns
     * `text-danger` when the file did not survive the decode. Ignored while a run mode is painting
     * the whole bar, because on-primary ink over the theme wash is the only readable option there.
     */
    tone?: string;
    /** For a cell whose visible text is a bare value that reads as nothing to a screen reader. */
    ariaLabel?: string;
    /** Verification hooks the cell wants on its element, e.g. `data-text-editor-encoding`. */
    dataAttributes?: Record<string, string>;
}) {
    const running = useContext(StatusBarRunningContext);
    const entryId = useContext(StatusBarEntryIdContext);
    const attributes = { "data-status-bar-entry-id": entryId, ...dataAttributes };
    // The tint change eases over 300ms to match the whole-bar transition in StatusBar, so the ink
    // and the background arrive together rather than the text snapping ahead of the wash.
    const tone = running
        ? `${emphasis ? "text-on-primary" : "text-on-primary/85"} ${
            onClick ? "cursor-default hover:bg-on-primary/15 hover:text-on-primary" : ""
        }`
        : `${toneOverride ?? (emphasis ? "text-fg-muted" : "text-fg-subtle")} ${
            onClick ? "cursor-default hover:bg-fill hover:text-fg" : ""
        }`;
    const className = `flex h-full items-center gap-1.5 px-2 text-2xs transition-colors duration-300 ${tone}`;
    if (!onClick) {
        return (
            <span className={className} title={title} aria-label={ariaLabel} {...attributes}>
                {children}
            </span>
        );
    }
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            aria-label={ariaLabel}
            className={className}
            {...attributes}
        >
            {children}
        </button>
    );
}
