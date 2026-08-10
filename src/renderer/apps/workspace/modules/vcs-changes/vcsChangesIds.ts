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
 * **Three members, and the third is why the tab exists at editor width** rather than living in the
 * 320px rail: a conflict needs room for "what the two sides are and
 * which one you want". Every place that switches on `mode` does so exhaustively and without a
 * `default`, so a fourth member produces a compile error at each of them rather than a silently
 * mishandled case - which is how this one was added.
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
    }
    /**
     * The open merge: one row per path it could not settle, each taken whole from one side.
     *
     * **Carries no paths.** They are re-read from the repository when the tab renders, because a
     * merge outlives this window and a list captured when the tab was opened would be a list from
     * before the author last touched it. It carries nothing at all, in fact - there is only ever
     * one merge open in a project.
     */
    | { readonly mode: "resolve" };

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
        case "resolve":
            // One id, like the working tree and for a stronger reason: a project has at most one
            // open merge, so a second tab for it would be a second view of the same decisions with
            // no way to tell which one the author acted in.
            return `${VCS_CHANGES_TAB_PREFIX}:resolve`;
    }
}
