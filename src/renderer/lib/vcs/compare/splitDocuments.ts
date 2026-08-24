import type { DocumentDiffEntry } from "@shared/documents/diff";
import type { DocumentKind } from "@shared/documents/types";

/**
 * Which documents are worth a tab of their own.
 *
 * The comparison's detail column is a few hundred pixels beside an index of every changed file, and
 * that is the right shape for most of what a project holds: a palette, a set of variants, a list of
 * audio tracks are all read as a handful of lines. What does not fit is anything the author wrote in
 * an EDITOR TAB - a story, a page of the interface, a blueprint graph - because for those the
 * question is never "which fields differ" but "what does it look like now", and the answer is the
 * document drawn at the size it is authored at.
 *
 * Three kinds, and they are the three that have a full editor behind them. A row of any other kind
 * is complete in the detail column, so offering to open it in a tab twice as wide would be offering
 * the same six lines with more space around them.
 *
 * **Read from the document kind, never from the path.** A story is one file per scene under a
 * directory the project names, and a project that renamed it would fall out of a path test without
 * anything failing.
 */
const SPLIT_DOCUMENT_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
    "story",
    "ui-document",
    "ui-graphs",
]);

/**
 * Whether this row opens as a split comparison.
 *
 * False for an entry the comparison did not classify, which is the honest answer: the split tab
 * draws one document two ways, and it has nothing to draw for a file nobody can say the format of.
 */
export function opensAsSplitComparison(entry: DocumentDiffEntry): boolean {
    return entry.documentKind !== undefined && SPLIT_DOCUMENT_KINDS.has(entry.documentKind);
}
