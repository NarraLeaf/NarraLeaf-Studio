import { useMemo } from "react";
import { countDocumentChanges, type DocumentDiff } from "@shared/documents/diff";
import { DocumentChangeList } from "../DocumentChangeList";
import type { ChangePresenter, ChangePresenterProps } from "./registry";

/**
 * The detail every format gets until something better is written for it.
 *
 * It is the same `DocumentChangeList` the version rail expands, given a pane instead of a 320px
 * column - so the two surfaces still name a change the same way, and everything that can be wrong
 * about the list (what fits, what was left out, which tier answered) stays in one place.
 *
 * Registered nowhere, and that is deliberate: it is `presenterFor`'s fallback, held as a constant by
 * the registry rather than pushed into it at import time. A fallback that depends on a module having
 * been loaded is a blank detail pane on whatever import order a bundler settles on.
 */

/**
 * Rows one document may draw here.
 *
 * The ceiling the tab used to apply per section, kept because the reason for it is unchanged: a
 * document may carry up to `DOCUMENT_DIFF_CHANGE_LIMIT` (200) changes, the list is not virtualised,
 * and past a screenful the honest answer is a count of what was left out. `DocumentChangeList` says
 * that count itself, so nothing is dropped in silence.
 */
export const DOCUMENT_ROW_CEILING = 200;

export function GenericChangeDetail({ entry, change }: ChangePresenterProps) {
    /**
     * One change selected out of the document reads as a diff of its own.
     *
     * Rebuilt rather than filtered in the list, so `DocumentChangeList` cannot tell the difference
     * between "this document has one change" and "one change is being looked at" - and so the
     * counts it draws are about what is on screen. The tier is carried over unchanged, because how
     * this change was produced is a property of the comparison and not of the selection.
     */
    const diff = useMemo<DocumentDiff>(() => {
        if (!change) {
            return entry.diff;
        }
        return {
            changes: [change],
            complete: (change.truncated ?? 0) === 0,
            total: countDocumentChanges([change]),
            tier: entry.diff.tier,
        };
    }, [entry.diff, change]);

    return (
        <DocumentChangeList
            diff={diff}
            limit={DOCUMENT_ROW_CEILING}
            // A document that appeared or disappeared whole has one row and no caveat to make about
            // it; the caption would otherwise claim it was unreadable. Suppressed only for the whole
            // document, never when one change inside it is selected.
            wholeDocument={change === undefined && (entry.kind === "added" || entry.kind === "removed")}
        />
    );
}

export const genericChangePresenter: ChangePresenter = {
    id: "generic",
    // Anything, which is what makes it the fallback rather than a competitor: a presenter that
    // matched only what nothing else claimed would have to know what else exists.
    matches: () => true,
    Detail: GenericChangeDetail,
};
