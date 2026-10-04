/**
 * The find overlay the translation and voice tables share.
 *
 * It floats over the top-right of the list rather than docking above it: these tables are read one
 * entry at a time, and a bar that pushes the list down moves the line the author was looking at the
 * moment they press Mod+F. The three option toggles are the ones the scene find bar and the project
 * search panel carry, driven by the same compiled matcher.
 *
 * State and matching live in {@link useTableFind}; this draws it.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, WholeWord, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import type { TableFind } from "./useTableFind";

/**
 * An option that is ON, in the accent rather than the shared neutral fill.
 *
 * `ToolbarButton`'s own `active` is a neutral wash, which is right for a pressed tool and too close
 * to its hover state for a switch: the whole job of these three is to answer "is this on?" at a
 * glance.
 */
const ACTIVE_TOGGLE_CLASS = "bg-primary/15 text-primary";

/** What in the table can take focus back when the bar closes, if nothing outside it held focus. */
const TABLE_FOCUSABLE_SELECTOR = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]";

export function TableFindOverlay({ find, placeholder }: {
    find: TableFind;
    /** Names what this table searches, in that table's own words. */
    placeholder: string;
}) {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);

    // Closing gives focus back to the table. The bar is unmounted when it closes, and focus inside it
    // would otherwise drop to the page, so the next arrow or Tab started from the top of the window
    // rather than from the row the author was on. What it goes back to is the last thing outside the
    // bar that held focus - the row Mod+F was pressed in, or one clicked since - else the first
    // control in the table.
    //
    // Not a floating layer, which is what popovers use for this: the bar stays open while the author
    // works in the table, so it must not close when focus leaves it, and an Escape pressed in the
    // table is not addressed to it.
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        const doc = root.ownerDocument;
        const outside = (node: unknown): node is HTMLElement =>
            node instanceof HTMLElement && node !== doc.body && !root.contains(node);
        let returnTo: HTMLElement | null = outside(doc.activeElement) ? doc.activeElement : null;
        const onFocusIn = (event: FocusEvent) => {
            if (outside(event.target)) {
                returnTo = event.target;
            }
        };
        doc.addEventListener("focusin", onFocusIn);
        return () => {
            doc.removeEventListener("focusin", onFocusIn);
            const active = doc.activeElement;
            const lost = !active || active === doc.body || !active.isConnected || root.contains(active);
            if (!lost) {
                return;
            }
            const target = returnTo?.isConnected
                ? returnTo
                : Array.from(root.parentElement?.querySelectorAll<HTMLElement>(TABLE_FOCUSABLE_SELECTOR) ?? [])
                    .find(element => !root.contains(element) && element.tabIndex >= 0);
            target?.focus({ preventScroll: true });
        };
    }, []);

    useEffect(() => {
        const input = inputRef.current;
        if (!input) {
            return;
        }
        input.focus();
        input.select();
    }, [find.focusToken]);

    const noMatches = find.invalidPattern || (find.query.length > 0 && find.matchCount === 0);

    return (
        <div
            ref={rootRef}
            className="absolute right-4 top-2 z-10 flex items-center gap-1.5 rounded-lg border border-edge bg-surface-overlay px-2 py-1.5 shadow-lg"
            // Deliberately without `stopPropagation`, which is where the scene find bar differs:
            // that one sits inside an editor with its own key handling, these tables have none. What
            // it buys is that a second Mod+F still reaches the shortcut and pulls focus back here.
            onKeyDown={event => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    find.close();
                    return;
                }
                if (event.key === "Enter") {
                    event.preventDefault();
                    find.step(event.shiftKey ? -1 : 1);
                }
            }}
        >
            <input
                ref={inputRef}
                value={find.query}
                onChange={event => find.setQuery(event.target.value)}
                placeholder={placeholder}
                aria-label={placeholder}
                data-tip={find.invalidPattern ? t("workspace.shell.tableFind.invalidPattern") : undefined}
                className={cn(
                    "h-7 w-48 rounded-md border bg-surface-sunken px-2 text-xs text-fg outline-none placeholder:text-fg-subtle",
                    noMatches ? "border-danger/60" : "border-edge focus:border-primary/50",
                )}
            />
            <ToolbarButton
                size="sm"
                onClick={find.toggleCaseSensitive}
                data-tip={t("workspace.shell.tableFind.caseSensitive")}
                aria-label={t("workspace.shell.tableFind.caseSensitive")}
                aria-pressed={find.caseSensitive}
                active={find.caseSensitive}
                className={cn(find.caseSensitive && ACTIVE_TOGGLE_CLASS)}
            >
                <CaseSensitive className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
                size="sm"
                onClick={find.toggleWholeWord}
                data-tip={t("workspace.shell.tableFind.wholeWord")}
                aria-label={t("workspace.shell.tableFind.wholeWord")}
                aria-pressed={find.wholeWord}
                active={find.wholeWord}
                className={cn(find.wholeWord && ACTIVE_TOGGLE_CLASS)}
            >
                <WholeWord className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
                size="sm"
                onClick={find.toggleRegex}
                data-tip={t("workspace.shell.tableFind.regex")}
                aria-label={t("workspace.shell.tableFind.regex")}
                aria-pressed={find.regex}
                active={find.regex}
                className={cn(find.regex && ACTIVE_TOGGLE_CLASS)}
            >
                <Regex className="h-3.5 w-3.5" />
            </ToolbarButton>
            <span className="min-w-14 shrink-0 text-2xs tabular-nums text-fg-subtle">
                {find.query.length === 0
                    ? ""
                    : find.invalidPattern
                        ? t("workspace.shell.tableFind.invalidPattern")
                        : find.matchCount === 0
                            ? t("workspace.shell.tableFind.noMatches")
                            : `${find.activeMatch}/${find.matchCount}`}
            </span>
            {/* The filter is the reason a hit is not on the page, and it is the one thing the count
                alone cannot say: the review and audition passes both open on a filter that holds
                most of the table back, so "No results" would otherwise be the answer for a line the
                author knows is there. */}
            {find.query.length > 0 && !find.invalidPattern && find.hiddenCount > 0 ? (
                <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">
                    {t("workspace.shell.tableFind.filterHidden", { count: find.hiddenCount })}
                </span>
            ) : null}
            <ToolbarButton
                size="sm"
                onClick={() => find.step(-1)}
                disabled={find.matchCount === 0}
                data-tip={t("workspace.shell.tableFind.previous")}
                aria-label={t("workspace.shell.tableFind.previous")}
            >
                <ChevronUp className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
                size="sm"
                onClick={() => find.step(1)}
                disabled={find.matchCount === 0}
                data-tip={t("workspace.shell.tableFind.next")}
                aria-label={t("workspace.shell.tableFind.next")}
            >
                <ChevronDown className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
                size="sm"
                onClick={find.close}
                data-tip={t("common.close")}
                aria-label={t("common.close")}
            >
                <X className="h-3.5 w-3.5" />
            </ToolbarButton>
        </div>
    );
}
