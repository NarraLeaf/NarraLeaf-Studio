import React, { useEffect, useRef } from "react";
import { Circle } from "lucide-react";

/**
 * One row in a {@link QuickSwitchOverlay}. `title`/`trailing` are `ReactNode` so callers can pass
 * highlighted fragments (fuzzy-match ranges) or shortcut chips, not just plain strings.
 */
export interface QuickListRow {
    /** Stable identity for the row — used as the React key and for scroll tracking. */
    key: string;
    icon?: React.ReactNode;
    title: React.ReactNode;
    /** Right-aligned content: a group id (quick switch) or a shortcut chip (command palette). */
    trailing?: React.ReactNode;
    /** Renders the small "modified" dot before the trailing content. */
    modified?: boolean;
    disabled?: boolean;
}

export interface QuickSwitchOverlaySearch {
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    inputRef?: React.RefObject<HTMLInputElement | null>;
    /** Accessible label for the input; falls back to `placeholder`. */
    ariaLabel?: string;
}

interface QuickSwitchOverlayProps {
    rows: QuickListRow[];
    selectedIndex: number;
    onCommit: (index: number) => void;
    onHoverIndex?: (index: number) => void;
    /** Accessible label for the listbox. */
    ariaLabel: string;
    /** When provided, a search input renders above the list (command-palette mode). */
    search?: QuickSwitchOverlaySearch;
    /** Shown in place of the list when there are no rows. */
    emptyText?: string;
    /** Stacking context for the outer layer; command palette sits above the quick switch. */
    zClassName?: string;
    /**
     * Where the card lands inside the window-content layer. Default is the quick-switch's
     * centered drop; the command palette anchors flush under the title bar instead, so it reads
     * as a dropdown of the title-bar search box (VSCode Quick Open).
     */
    placementClassName?: string;
    /** Card width; the palette widens to mirror the title-bar search box. */
    widthClassName?: string;
    /**
     * Inline style for the card (e.g. a measured `marginLeft` pinning it under an anchor element
     * whose center is not the window's center). Pair with a placement that omits justify-center.
     */
    cardStyle?: React.CSSProperties;
}

/**
 * The floating list overlay shared by the editor quick switch and the command palette: a centered
 * card near the top of the window holding an optional search box and a single-select, keyboard-
 * driven list. Purely presentational — selection state, key handling, and commit semantics belong
 * to the owner. It only owns what is intrinsic to *showing* the list: keeping the selected row
 * scrolled into view, and translating clicks/hover into index callbacks.
 */
export function QuickSwitchOverlay({
    rows,
    selectedIndex,
    onCommit,
    onHoverIndex,
    ariaLabel,
    search,
    emptyText,
    zClassName = "z-[45]",
    placementClassName = "items-start justify-center pt-[12vh]",
    widthClassName = "w-[min(560px,calc(100vw-32px))]",
    cardStyle,
}: QuickSwitchOverlayProps) {
    const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    // Keep the active row visible as selection moves (arrow keys, Ctrl+Tab, or filtering).
    useEffect(() => {
        const key = rows[selectedIndex]?.key;
        if (!key) {
            return;
        }
        rowRefs.current.get(key)?.scrollIntoView({ block: "nearest" });
    }, [rows, selectedIndex]);

    return (
        <div
            className={`nl-window-content-layer ${zClassName} flex ${placementClassName} pointer-events-none`}
        >
            <div
                className={`flex ${widthClassName} max-h-[min(480px,70vh)] flex-col overflow-hidden rounded-md border border-edge bg-surface-raised/95 shadow-2xl backdrop-blur-sm pointer-events-auto`}
                style={cardStyle}
            >
                {search && (
                    <div className="shrink-0 border-b border-edge px-3">
                        <input
                            ref={search.inputRef}
                            type="text"
                            value={search.value}
                            placeholder={search.placeholder}
                            aria-label={search.ariaLabel ?? search.placeholder}
                            spellCheck={false}
                            autoComplete="off"
                            autoCorrect="off"
                            className="h-11 w-full bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
                            onChange={(event) => search.onChange(event.target.value)}
                            onKeyDown={search.onKeyDown}
                        />
                    </div>
                )}

                {rows.length === 0 ? (
                    emptyText ? (
                        <div className="px-3 py-6 text-center text-sm text-fg-subtle">{emptyText}</div>
                    ) : null
                ) : (
                    <div
                        className="min-h-0 flex-1 overflow-y-auto py-1"
                        role="listbox"
                        aria-label={ariaLabel}
                    >
                        {rows.map((row, index) => {
                            const selected = index === selectedIndex;
                            return (
                                <button
                                    key={row.key}
                                    ref={(node) => {
                                        if (node) {
                                            rowRefs.current.set(row.key, node);
                                        } else {
                                            rowRefs.current.delete(row.key);
                                        }
                                    }}
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    disabled={row.disabled}
                                    data-quick-list-key={row.key}
                                    // Keep DOM focus where it is (search input / prior focus) so the
                                    // list stays keyboard-drivable while the mouse hovers or clicks.
                                    onMouseDown={(event) => event.preventDefault()}
                                    onMouseEnter={onHoverIndex ? () => onHoverIndex(index) : undefined}
                                    onClick={() => onCommit(index)}
                                    className={`flex h-10 w-full items-center gap-3 px-3 text-left transition-colors ${
                                        row.disabled
                                            ? "cursor-not-allowed text-fg-subtle"
                                            : selected
                                                ? "bg-primary/20 text-fg"
                                                : "text-fg-muted hover:bg-fill-subtle hover:text-fg"
                                    }`}
                                >
                                    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-muted">
                                        {row.icon}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-sm">{row.title}</span>
                                    {row.modified && (
                                        <Circle className="h-2 w-2 shrink-0 fill-current text-primary" />
                                    )}
                                    {row.trailing !== undefined && row.trailing !== null && (
                                        <span className="shrink-0 text-xs text-fg-subtle">{row.trailing}</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
