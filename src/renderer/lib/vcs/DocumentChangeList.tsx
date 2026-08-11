import type { ReactNode } from "react";
import type { DocumentDiff } from "@shared/documents/diff";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import {
    buildDocumentChangeRows,
    CHANGE_KIND_GLYPH,
    CHANGE_KIND_TINT,
    documentDiffEmptyKey,
    documentDiffTierCaption,
    resolveDocumentChangeLabel,
    type DocumentChangeRow,
} from "./documentChangeView";

/**
 * One document's changes, drawn the same way in both places they appear.
 *
 * The version rail expands it under a file row at 320px; the `vcs-changes` tab draws it at editor
 * width, as the body of its detail pane and through the generic presenter
 * (`vcs/presenters/GenericChangeDetail`). `dense` is the whole of the difference, because two
 * renderings of one list would drift and the author would have to learn each of them. Everything
 * that can be wrong about the list - what fits, what was left out, how a label becomes text - is in
 * `documentChangeView`, not here.
 *
 * **It draws one document, and is no longer what a list of documents is made of.** The tab used to
 * mount one of these per changed file, stacked; now the file list is an index of one line per file
 * (`vcs/changeIndex`) and exactly one of these is on screen at a time. That is why nothing here
 * needs to be smaller than it is: the caveats below have a pane to be stated in.
 *
 * Three things this must never do quietly, all of them the same failure in different clothes:
 *
 *  - **hide the tier.** A structural list of JSON paths looks exactly like a semantic list of
 *    authored changes and is a much weaker claim, so every tier but `semantic` wears a caption.
 *  - **hide `truncated`.** A group that dropped children says so on its own row.
 *  - **hide an incomplete list.** Rows the cap left out are counted in a line of their own, or in
 *    the `footer` the caller supplies when it has somewhere wider to send the author. `hidden > 0`
 *    is what that line is keyed on rather than `DocumentDiff.complete`, and the two cannot disagree:
 *    an incomplete diff has a `total` above everything it materialised, so anything it dropped shows
 *    up as hidden here however much room this list had (pinned in `documentChangeView.test.ts`).
 */
export interface DocumentChangeListProps {
    readonly diff: DocumentDiff;
    /** Rows, not changes - a group and its children are separate rows. */
    readonly limit: number;
    /** The 320px rendering: smaller type, tighter rows. */
    readonly dense?: boolean;
    /**
     * What to offer instead of a plain count when rows were left out - the rail's "view all N".
     *
     * Absent means the surface has nowhere wider to send the author, and the omission is stated as a
     * number instead. Never nothing: a list that stops at its limit in silence is read as complete.
     */
    readonly footer?: ReactNode;
    /**
     * Whether the whole document appeared or disappeared, when the caller knows.
     *
     * It suppresses the tier caption, and the reason is that the caption would otherwise say
     * something false. A document that was added has nothing to be compared against, so the engine
     * reports it as one `opaque` row on purpose - but `opaque`'s caption reads "Not read" and its
     * hint offers "too large, not text, or unreadable", none of which happened. Seen in the real
     * app: a new 20-byte `.txt` announced itself as unreadable.
     *
     * A caption is a caveat about how the rows below were produced. For a document that is wholly
     * added or removed there is exactly one row and it is not in doubt, so there is no caveat.
     *
     * A boolean rather than a change kind because the two callers speak different vocabularies -
     * the working-tree list says `deleted` and the diff model says `removed` - and a prop typed as
     * either one silently accepts the other's spelling as "not whole" rather than failing.
     */
    readonly wholeDocument?: boolean;
}

export function DocumentChangeList({ diff, limit, dense = false, footer, wholeDocument }: DocumentChangeListProps) {
    const { t } = useTranslation();
    const caption = wholeDocument ? null : documentDiffTierCaption(diff.tier);
    const { rows, hidden } = buildDocumentChangeRows(diff, limit);
    const textSize = dense ? "text-2xs" : "text-xs";

    return (
        <div className="min-w-0">
            {caption && (
                // Quiet by design: one dimmed line, no badge and no colour. It is a caveat about how
                // the rows below were produced, not a status of the document - and a 320px rail has
                // no room for something that looks like a warning next to fifty file rows.
                <p className={cn("truncate text-2xs text-fg-subtle", dense ? "" : "mb-0.5")} title={t(caption.hintKey)}>
                    {t(caption.key)}
                </p>
            )}

            {rows.length === 0 && (
                <p className={cn(textSize, "text-fg-subtle")}>{t(documentDiffEmptyKey(diff.tier))}</p>
            )}

            {rows.map(row => (
                <ChangeLine key={row.key} row={row} dense={dense} />
            ))}

            {hidden > 0 && (
                footer ?? (
                    <p className={cn("pt-0.5 text-2xs text-fg-subtle")}>
                        {t("documentDiff.rows.showing", {
                            shown: String(diff.total - hidden),
                            total: String(diff.total),
                        })}
                    </p>
                )
            )}
        </div>
    );
}

/**
 * One row.
 *
 * `primary` is the author's own word wherever there is one and the translated label otherwise, which
 * is why the two swap places rather than both being drawn: `resolveDocumentChangeLabel` owns that
 * decision, and it exists because the same word arrives as a subject on one tier and as a label
 * parameter on another.
 */
function ChangeLine({ row, dense }: { row: DocumentChangeRow; dense: boolean }) {
    const translator = useTranslation();
    const { t } = translator;
    const label = resolveDocumentChangeLabel(row.change, translator);
    const path = row.change.path.join(" / ");
    const textSize = dense ? "text-2xs" : "text-xs";

    return (
        <div
            className={cn(
                "flex items-baseline gap-1.5 overflow-hidden",
                dense ? "py-px" : "py-0.5",
                row.depth === 1 && (dense ? "pl-3" : "pl-4"),
            )}
            // The full path, because a row shows the change and not where in the document it sits.
            // Absent for a change at the document root, where there is no path to give.
            title={path || undefined}
        >
            <span
                aria-hidden
                className={cn("w-2 shrink-0 text-center font-mono text-2xs", CHANGE_KIND_TINT[row.change.kind])}
            >
                {CHANGE_KIND_GLYPH[row.change.kind]}
            </span>
            <span className={cn("min-w-0 truncate", textSize, dense ? "text-fg-muted" : "text-fg")}>
                {label.primary}
            </span>
            {label.detail && (
                <span className="min-w-0 shrink truncate text-2xs text-fg-subtle">{label.detail}</span>
            )}
            {(label.from !== undefined || label.to !== undefined) && (
                <ValuePair from={label.from} to={label.to} />
            )}
            {row.truncated > 0 && (
                <span
                    className="ml-auto shrink-0 text-2xs text-fg-subtle"
                    title={t("documentDiff.rows.moreInGroup", { count: String(row.truncated) })}
                >
                    +{row.truncated}
                </span>
            )}
        </div>
    );
}

/**
 * The two values a change sits between.
 *
 * Drawn rather than worded: an arrow is not language, so no locale has to spell "a became b" once
 * per kind of thing that can change, and a narrow column truncates the VALUE instead of the sentence
 * around it. One side alone is the ordinary case - a key that only appeared has no old value - and
 * renders as that side with no arrow, because the row's own marker already says which happened.
 *
 * An EMPTY value renders as empty rather than as a stand-in, with both sides still present: a
 * document whose name was blank and is now `Chapter One` reads as an arrow with nothing before it,
 * which is what happened. Anything drawn in that gap would be a value Studio invented.
 */
function ValuePair({ from, to }: { from?: string; to?: string }) {
    return (
        <span className="flex min-w-0 shrink items-baseline gap-1 text-2xs text-fg-subtle">
            {from !== undefined && (
                <span className="min-w-0 max-w-[12rem] truncate font-mono" title={from || undefined}>
                    {from}
                </span>
            )}
            {from !== undefined && to !== undefined && <span aria-hidden>→</span>}
            {to !== undefined && (
                <span className="min-w-0 max-w-[12rem] truncate font-mono text-fg-muted" title={to || undefined}>
                    {to}
                </span>
            )}
        </span>
    );
}
