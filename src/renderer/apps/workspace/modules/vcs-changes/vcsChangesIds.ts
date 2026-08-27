import type { RevisionId } from "@shared/types/vcs";

/**
 * What the `vcs-changes` tab is a view of, and the id that follows from it.
 *
 * Kept apart from both the tab and the things that open it, for the reason `lintIds` is: the rail
 * opens the tab and the tab does not import the rail, so the name they address each other by cannot
 * live in either file without making the two import each other.
 */

/** Every id this tab uses starts here, so one of them is recognisable wherever tab ids are read. */
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
    /**
     * The author's uncommitted work against the last version. Never cached; it scans (docs §4.17).
     *
     * `headNumber` is the number the opener was already showing for the version being compared
     * against - the `#36` on the rail, in the status cell and in the switcher menu - carried so the
     * tab's heading opens on that same name instead of on a placeholder one frame before it knows
     * better.
     *
     * **A hint, not the answer.** The tab reads the head's number for itself once the comparison
     * has answered, because a number captured when the tab was opened describes the repository as
     * it was then, and this tab outlives commits. Optional in the same honest sense: an opener that
     * does not already hold the number passes nothing rather than reading the repository to fill it
     * in. A NUMBER rather than a rendered `#36`, so `revisionLabel` stays the one thing that decides
     * how a version is spelled.
     */
    | { readonly mode: "working-tree"; readonly headNumber?: number }
    /**
     * Two revisions, each named by its number - `#12`, the name every other version surface uses.
     *
     * Both numbers are REQUIRED, and that is what makes naming either side by hash unrepresentable
     * rather than merely discouraged: this pair is immutable, every way into the comparison already
     * holds both numbers, and once the tab is open there is nothing cheap to re-read them from.
     */
    | {
        readonly mode: "between";
        readonly from: RevisionId;
        readonly to: RevisionId;
        readonly fromNumber: number;
        readonly toNumber: number;
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
