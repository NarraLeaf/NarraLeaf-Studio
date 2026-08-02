import type { RevisionId } from "@shared/types/vcs";

/**
 * What the `vcs-changes` tab is a view of, and the id that follows from it.
 *
 * Kept apart from both the tab and the things that open it, for the reason `lintIds` is: the rail
 * opens the tab and the tab does not import the rail, so the name they address each other by cannot
 * live in either file without making the two import each other.
 */

/** Every id this tab uses starts here, so a stale one is recognisable in a persisted layout. */
const VCS_CHANGES_TAB_PREFIX = "narraleaf-studio:vcs-changes";

/**
 * Which comparison a tab shows.
 *
 * **A third member is coming and this union is shaped for it.** D6 adds `{mode: "resolve"}` - the
 * same `DocumentChange` list with a side to take per row - which is the whole reason the tab exists
 * at editor width rather than living in the 320px rail (plan 2026-07-31-004 §3.2). Every place that
 * switches on `mode` does so exhaustively and without a `default`, so adding that member produces a
 * compile error at each of them rather than a silently mishandled case.
 */
export type VcsChangesPayload =
    /** The author's uncommitted work against the last version. Never cached; it scans (docs §4.17). */
    | { readonly mode: "working-tree" }
    /**
     * Two revisions. `fromLabel` / `toLabel` are how the author was already naming them (`#12`);
     * absent falls back to a short hash, because a comparison entered from somewhere that did not
     * pass a label still has to say which two versions it is between.
     */
    | {
        readonly mode: "between";
        readonly from: RevisionId;
        readonly to: RevisionId;
        readonly fromLabel?: string;
        readonly toLabel?: string;
    };

/**
 * The tab id for one comparison.
 *
 * The working tree gets ONE id, so "view all N" pressed on five different files lands in the tab
 * that is already open instead of accumulating five copies of the same list. A revision pair gets
 * one id per pair, because two comparisons of different versions are genuinely two documents and
 * collapsing them would make opening the second silently replace the first.
 */
export function vcsChangesTabId(payload: VcsChangesPayload): string {
    switch (payload.mode) {
        case "working-tree":
            return `${VCS_CHANGES_TAB_PREFIX}:working-tree`;
        case "between":
            return `${VCS_CHANGES_TAB_PREFIX}:${payload.from}..${payload.to}`;
    }
}
