import type {DocumentKind} from "./types";

/**
 * What changed inside one document, in the one shape every producer answers with.
 *
 * Shared because the two halves live in different processes: only the main process can
 * reach a revision's bytes, and only the renderer can draw them. A change is therefore
 * plain transferable data - no functions, no class instances, nothing that has to be
 * revived on the other side of IPC.
 *
 * The same list is also what a conflict resolution is made of: one row per thing that
 * differs, with a side to take. That is why nothing here is named after diffing - a
 * second model for merging would be the same rows with a different spelling, and the
 * two would drift the moment one of them gained a field.
 */

export type DocumentChangeKind = "added" | "removed" | "changed" | "moved";

/**
 * Which of the four tiers produced a diff. See `vcs/diff/documentDiff.ts` for what
 * each one costs and when it is reached.
 *
 * **The least conspicuous field here and the most important one.** A structural diff
 * renders as a tidy list of paths and values, which is indistinguishable at a glance
 * from a semantic one - and it is not the same claim. `semantic` says "a spec that
 * understands this format decided these are the changes an author cares about";
 * `structural` says "nobody here knows what this file means, these are the JSON paths
 * whose values differ", which on a document full of generated ids is mostly noise
 * wearing the same clothes. A surface that draws them identically is lying, and the
 * author's only way to find out is to act on a change that was never a change.
 */
export type DocumentDiffTier = "semantic" | "summary" | "structural" | "opaque";

/**
 * How to read a change out loud: a translation KEY plus parameters, never a sentence.
 *
 * A produced sentence would be main-process English baked into a renderer that has a zh
 * catalogue - and worse, baked into data that D5's resolve flow writes back into the
 * repository, where it would outlive the language it was written under.
 */
export interface DocumentChangeLabel {
    readonly key: string;
    readonly params?: Readonly<Record<string, string | number>>;
}

export interface DocumentChange {
    /**
     * Where in the document this change is, **and the unit a resolution is taken on**.
     *
     * Stable: two diffs of the same pair of documents must name the same thing with the
     * same path, because that is the only handle a "take theirs for this one" decision
     * has. Segments are the document's own structure (an object key, an array index as
     * text) rather than anything display-shaped.
     */
    readonly path: readonly string[];
    readonly kind: DocumentChangeKind;
    readonly label: DocumentChangeLabel;
    /**
     * The name the author wrote: a scene title, a character name, a localization key.
     *
     * **Never translated and never invented.** It is shown verbatim beside the
     * translated label, so anything put here that Studio made up (a kind name, a
     * generated id) reads to the author as something they typed.
     */
    readonly subject?: string;
    /**
     * Changes below this one. **At most one level** - the shape is document -> group ->
     * leaf and no deeper, because a tree of unbounded depth cannot be drawn in a 320px
     * rail and cannot be resolved row by row without inventing what a partially accepted
     * subtree means.
     */
    readonly children?: readonly DocumentChange[];
    /**
     * Children dropped to stay inside the budget. Non-zero obliges the surface to say so.
     *
     * Silence here is the failure this field exists to prevent: a list that stops at the
     * limit with nothing said is read as a complete list, and the author concludes the
     * change they are looking for did not happen.
     */
    readonly truncated?: number;
}

export interface DocumentDiff {
    readonly changes: readonly DocumentChange[];
    /** False = the budget was reached. The surface must say so rather than truncate silently. */
    readonly complete: boolean;
    /**
     * Every change found, including the ones {@link changes} does not carry.
     *
     * Counted by leaf: a group of three counts three, so `total` and the number of rows
     * on screen are not the same number and are not meant to be.
     */
    readonly total: number;
    readonly tier: DocumentDiffTier;
}

/**
 * What a three-way merge did with one path, and whether it is still the author's to decide.
 *
 * `auto-*` says one side changed and the other did not, so there was a right answer and it was
 * taken; the author may still flip it. `conflict` says both sides changed it differently and
 * nothing here is entitled to choose - see {@link DocumentMerge3.document} for what the merged
 * document holds until they do.
 */
export type DocumentMergeOutcome = "auto-mine" | "auto-theirs" | "conflict";

/** What one side holds at a path. `present: false` is a side that does not have it at all. */
export interface DocumentMergeSide {
    readonly present: boolean;
    /**
     * The side's value, as plain JSON. Absent when the side does not hold the path.
     *
     * Carried rather than previewed because a conflict is a choice: the surface has to draw
     * both translations, both asset records, both of whatever this is, and a truncated preview
     * is not something an author can decide on. Bounded by the fact that a decision is taken on
     * one entry of a keyed collection - never on the document.
     */
    readonly value?: unknown;
}

/**
 * One decision a three-way merge took or is waiting on.
 *
 * **Addressed by the same `path` a {@link DocumentChange} uses**, and that is the design rather
 * than a convenience: the premise is that a comparison and a resolution are one list seen twice,
 * so a spec's `diff` and its `merge3` name the same thing with the same path and a surface can
 * put a decision beside the change it belongs to. A second addressing scheme here would make
 * that impossible to do reliably and easy to do wrongly.
 *
 * An empty `path` names the document itself - what a spec that cannot merge a document at all
 * answers with, as one whole-document conflict rather than by pretending to have merged it.
 */
export interface DocumentMergeDecision {
    readonly path: readonly string[];
    readonly outcome: DocumentMergeOutcome;
    /**
     * How to read the row, when this format has words for it.
     *
     * Optional for the same reason {@link DocumentSpec.diff} is optional: a format whose merge
     * is implemented before its semantic diff has no label vocabulary yet, and inventing a key
     * here would put an untranslated dotted path in front of the author - the exact failure
     * `documentDiffKeys.test.ts` exists to catch. A surface must have a fallback for a decision
     * with no label; it must never invent one that looks translated.
     */
    readonly label?: DocumentChangeLabel;
    /** The author's own word for this thing, on the same terms as {@link DocumentChange.subject}. */
    readonly subject?: string;
    readonly mine: DocumentMergeSide;
    readonly theirs: DocumentMergeSide;
}

/**
 * The result of a three-way merge: a document that can always be written, plus what was decided.
 *
 * The invariant that makes per-change resolution possible at all is on {@link document}: it is a
 * complete, valid document of this format at every moment, including while conflicts are still
 * open. Nothing in it is a marker, a hole or a half-value, so the author can stop halfway,
 * Studio can write the file, and the merge can be picked up again later.
 */
export interface DocumentMerge3<T> {
    /**
     * The merged document, with every `auto-*` decision applied and every conflict left holding
     * **base** - or **mine**, when there is no base.
     *
     * Base rather than either side because holding a side is taking the decision: an author who
     * never looks at the row would ship whichever one this code happened to prefer, and nothing
     * would ever say so. Base is the one value that is not a choice - it is where both sides
     * started - and when there is no base at all (add/add) mine is the only other value that is
     * demonstrably already in this author's tree.
     */
    readonly document: T;
    readonly decisions: readonly DocumentMergeDecision[];
    /** How many of {@link decisions} are still the author's, i.e. `outcome === "conflict"`. */
    readonly conflicts: number;
}

/** One document's changes, as a revision or working-tree comparison reports them. */
export interface DocumentDiffEntry {
    /** Repository-relative, forward slashes - the same spelling the change lists use. */
    readonly path: string;
    /** What happened to the document itself, as opposed to what changed inside it. */
    readonly kind: DocumentChangeKind;
    /** The document format, when a spec claims this path. Absent is the ordinary answer. */
    readonly documentKind?: DocumentKind;
    readonly diff: DocumentDiff;
}

/**
 * How many changes a list stands for, counting a group's children rather than the group
 * and including the ones a group already dropped.
 *
 * The number an author is told; {@link materializedChanges} is the number of rows they
 * can actually see, and the two differ exactly when something was truncated.
 */
export function countDocumentChanges(changes: readonly DocumentChange[]): number {
    let count = 0;
    for (const change of changes) {
        count += (change.children?.length ?? 1) + (change.truncated ?? 0);
    }
    return count;
}

/** Rows this list really carries - what {@link countDocumentChanges} would be with nothing dropped. */
function materializedChanges(changes: readonly DocumentChange[]): number {
    let count = 0;
    for (const change of changes) {
        count += change.children?.length ?? 1;
    }
    return count;
}

export interface BuildDocumentDiffOptions {
    readonly tier: DocumentDiffTier;
    readonly limit: number;
    /**
     * Changes the producer counted but did not build, when it stopped materialising to
     * stay inside memory. Defaults to counting what was handed over.
     */
    readonly total?: number;
}

/**
 * Assemble a diff, truncating to the budget from the END of an ALREADY ORDERED list.
 *
 * The ordering is the caller's job and the order of these two steps is the whole point:
 * truncating first and sorting afterwards produces a list that is sorted and arbitrary -
 * the rows that survived are the ones that happened to be built first, which on a
 * document walked in structural order means "whatever is alphabetically early", and the
 * author is shown a confident, ranked, wrong answer. Every change list in Studio sorts
 * before it truncates for this reason.
 */
export function buildDocumentDiff(
    changes: readonly DocumentChange[],
    options: BuildDocumentDiffOptions,
): DocumentDiff {
    const total = options.total ?? countDocumentChanges(changes);
    const kept: DocumentChange[] = [];
    let budget = Math.max(0, options.limit);

    for (const change of changes) {
        if (budget <= 0) {
            break;
        }
        const leaves = change.children?.length ?? 1;
        if (leaves <= budget) {
            kept.push(change);
            budget -= leaves;
            continue;
        }
        // A group that does not fit is kept with fewer children rather than dropped: the
        // author needs to know the group changed at all, and `truncated` is what says the
        // rest is missing.
        if (change.children) {
            kept.push({
                ...change,
                children: change.children.slice(0, budget),
                truncated: (change.truncated ?? 0) + (change.children.length - budget),
            });
        }
        budget = 0;
    }

    return {
        changes: kept,
        // Against what is really on the list, not against what it stands for: a group
        // holding three of its five children reports five, and reading THAT would call a
        // truncated diff complete.
        complete: materializedChanges(kept) >= total,
        total,
        tier: options.tier,
    };
}
