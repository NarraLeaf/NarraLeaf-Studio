import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { DocumentChange, DocumentDiffEntry } from "@shared/documents/diff";
import type { TranslationKey } from "@shared/i18n";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { GenericChangeDetail } from "./GenericChangeDetail";
import { CHANGE_MASK_CLASS, CHANGE_MASK_LABEL, CHANGE_MASK_TONES, type ChangeMaskTone } from "./changeMask";

/**
 * The frame the two mask canvases share: a page of the interface, and a blueprint graph.
 *
 * They are the same surface with different middles - a control that picks what to look at, a legend
 * for the four marks, two columns, whatever the canvas could not say, and the list of rows
 * underneath. Written once so the two cannot drift into looking like two features.
 *
 * **The list of rows is always there, under the canvas.** It is the same `GenericChangeDetail` every
 * other format gets, and keeping it is what makes the canvas an addition rather than a replacement:
 * a page that will not draw, a change that cannot be marked and a document nobody can parse all
 * still have somewhere to be read. Clicking a mark narrows that list to the one change instead of
 * navigating away from it.
 */

export interface CanvasShellProps {
    readonly entry: DocumentDiffEntry;
    /** The selection the tab handed down, when it is finer than the file. */
    readonly change?: DocumentChange;
    /** The change a mark was clicked on, which narrows the list below. */
    readonly selected: DocumentChange | null;
    readonly onClearSelection: () => void;
    /** What to look at: a page, a graph. Absent when there is only one of them. */
    readonly controls?: ReactNode;
    readonly legend?: ReactNode;
    readonly notes?: ReactNode;
    readonly children: ReactNode;
}

export function CanvasShell(props: CanvasShellProps) {
    const { t } = useTranslation();
    const { entry, change, selected, onClearSelection, controls, legend, notes, children } = props;

    return (
        <div className="flex flex-col gap-2 py-1">
            {(controls || legend) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {controls}
                    {legend}
                </div>
            )}

            {children}

            {notes}

            {selected && (
                <div className="flex items-center gap-2">
                    <span className="text-2xs text-fg-muted">{t("documentDiff.canvas.oneChange")}</span>
                    <button
                        type="button"
                        onClick={onClearSelection}
                        className="nl-focus-ring inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 text-2xs text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                    >
                        <X className="h-3 w-3" />
                        {t("documentDiff.canvas.showAll")}
                    </button>
                </div>
            )}

            <GenericChangeDetail entry={entry} change={selected ?? change} />
        </div>
    );
}

/** The words under one column, and its size where there is one to state. */
export function CanvasColumn({ caption, detail }: { caption: TranslationKey; detail: string | null }) {
    const { t } = useTranslation();
    return (
        <figcaption className="truncate text-2xs text-fg-subtle">
            {[t(caption), detail].filter(Boolean).join(" · ")}
        </figcaption>
    );
}

export function CanvasNote({ tone, children }: { tone: "muted" | "danger"; children: ReactNode }) {
    return (
        <p className={cn("text-2xs", tone === "danger" ? "text-danger" : "text-fg-muted")}>{children}</p>
    );
}

/**
 * What the four washes mean, over the ones that are actually on screen.
 *
 * Only the tones present, because a legend that lists four marks over a canvas carrying one teaches
 * the author to look for three things that are not there.
 */
export function MaskLegend({ tones }: { tones: readonly ChangeMaskTone[] }) {
    const { t } = useTranslation();
    const present = CHANGE_MASK_TONES.filter(tone => tones.includes(tone));
    if (present.length === 0) {
        return null;
    }
    return (
        <ul className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {present.map(tone => (
                <li key={tone} className="flex items-center gap-1 text-2xs text-fg-muted">
                    <span
                        aria-hidden
                        data-mask-legend={tone}
                        className={cn("h-2.5 w-2.5 rounded-sm border", CHANGE_MASK_CLASS[tone])}
                    />
                    {t(CHANGE_MASK_LABEL[tone])}
                </li>
            ))}
        </ul>
    );
}

/**
 * The changes that are not marked on what is on screen, in one line and never in silence.
 *
 * Three different absences, kept apart because the author's next move differs for each: a change on
 * another page or graph is one selector away, a change that belongs to no canvas cannot be drawn at
 * all, and a change the canvas failed to place is a shortfall of this surface rather than of the
 * comparison. Collapsing them into "3 not shown" would leave an author unable to tell which.
 */
export function UnmarkedNote({
    elsewhere,
    elsewhereKey,
    offCanvas,
    unplaced,
}: {
    readonly elsewhere: number;
    /** "on other pages" or "in other graphs" - the only word the two canvases do not share. */
    readonly elsewhereKey: TranslationKey;
    readonly offCanvas: number;
    readonly unplaced: number;
}) {
    const { t, tn } = useTranslation();
    const parts: string[] = [];
    if (elsewhere > 0) {
        parts.push(t(elsewhereKey, { count: elsewhere }));
    }
    if (offCanvas > 0) {
        parts.push(t("documentDiff.canvas.offCanvas", { count: offCanvas }));
    }
    if (unplaced > 0) {
        parts.push(t("documentDiff.canvas.unplaced", { count: unplaced }));
    }
    if (parts.length === 0) {
        return null;
    }
    return (
        <CanvasNote tone="muted">
            {tn("documentDiff.canvas.notMarked", elsewhere + offCanvas + unplaced)} {parts.join(" · ")}
        </CanvasNote>
    );
}

/**
 * Why nothing could be drawn, when nothing could.
 *
 * The side with something to say wins, newer side first: with one side absent by construction, the
 * other one's reason is the whole reason. A read that failed and a document that would not parse
 * stay two different sentences, because one is the repository and the other is the file, and an
 * author told the wrong one looks in the wrong place.
 */
export function canvasReadFailure(
    base: { status: string; error: string | null },
    head: { status: string; error: string | null },
): { key: TranslationKey; error: string } | null {
    for (const side of [head, base]) {
        if (side.status === "unreadable" || side.status === "failed") {
            return {
                key: side.status === "unreadable"
                    ? "documentDiff.canvas.unreadable"
                    : "documentDiff.canvas.readFailed",
                error: side.error ?? "",
            };
        }
        if (side.status === "tooLarge") {
            return { key: "documentDiff.canvas.tooLarge", error: "" };
        }
    }
    return null;
}

/**
 * How wide the canvas may be, measured rather than assumed.
 *
 * The scale both columns share is worked out from it, and it has to be a measurement: the detail
 * pane is between a resizable index and the window edge, so there is no number anywhere that says
 * how much room there is. Zero until the first measurement, which is the signal to draw nothing yet
 * - a canvas drawn at a guessed width would be re-laid-out one frame later at a different scale.
 */
export function useCanvasWidth(): [number, (node: HTMLElement | null) => void] {
    const [width, setWidth] = useState(0);
    const observed = useRef<HTMLElement | null>(null);
    const observer = useRef<ResizeObserver | null>(null);

    const attach = useCallback((node: HTMLElement | null) => {
        observed.current = node;
        observer.current?.disconnect();
        if (!node) {
            return;
        }
        setWidth(node.clientWidth);
        if (typeof ResizeObserver === "undefined") {
            return;
        }
        observer.current = new ResizeObserver(entries => {
            const measured = entries[0]?.contentRect.width ?? node.clientWidth;
            setWidth(current => (Math.abs(current - measured) < 1 ? current : measured));
        });
        observer.current.observe(node);
    }, []);

    useEffect(() => () => observer.current?.disconnect(), []);

    return [width, attach];
}
