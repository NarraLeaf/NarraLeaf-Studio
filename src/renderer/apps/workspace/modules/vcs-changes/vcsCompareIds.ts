import type { VcsChangesPayload } from "./vcsChangesIds";

/**
 * What the split comparison tab is a view of, and the id that follows from it.
 *
 * Apart from both the tab and the things that open it, for the reason `vcsChangesIds` is: the
 * comparison opens this tab and this tab does not import the comparison, so the name they address
 * each other by cannot live in either file without making the two import each other.
 */

const VCS_COMPARE_TAB_PREFIX = "narraleaf-studio:vcs-compare";

/**
 * One document, at the two versions a comparison is between.
 *
 * The comparison is carried whole rather than reduced to two revision ids, so this tab names its
 * versions the way every other version surface does - `#12`, from the number - instead of falling
 * back to a hash it would have to fetch a name for. It is the same payload the comparison tab holds,
 * minus the merge, which is not a comparison of two versions and has no document to open.
 */
export interface VcsComparePayload {
    readonly comparison: Exclude<VcsChangesPayload, { mode: "resolve" }>;
    /** Repository-relative, and the address the tab re-reads the document at. */
    readonly path: string;
    /**
     * What to call it in the tab strip.
     *
     * Carried rather than derived, because the comparison already worked it out: an asset is named
     * by its record and a document set by its manifest, so a name taken from the path here would
     * disagree with the row the author pressed.
     */
    readonly name: string;
}

/**
 * One tab per document per comparison.
 *
 * Not one tab for the whole comparison: two documents opened side by side are two documents, and
 * collapsing them would make opening the second silently replace the first - which is exactly the
 * thing an author does when they want to look at both. Not one tab per document either, because the
 * same file compared across two different version pairs is two different questions.
 */
export function vcsCompareTabId(payload: VcsComparePayload): string {
    const comparison = payload.comparison.mode === "between"
        ? `${payload.comparison.from}..${payload.comparison.to}`
        : "working-tree";
    return `${VCS_COMPARE_TAB_PREFIX}:${comparison}:${payload.path}`;
}
