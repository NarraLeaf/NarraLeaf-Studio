import {DocumentMergeDecision, DocumentMergeSide} from "../diff";
import {sameJsonValue} from "./diffHelpers";

/**
 * The three-way merge every keyed document turns out to be.
 *
 * Translations, assets, scenes, blocks and characters are all stored as a map from a stable id
 * to a record, so "the same thing on both sides" is already written down and a merge does not
 * have to guess at it - the same property that makes their semantic diffs cheap (see
 * `diffHelpers.diffKeyed`). Written once because three specs would otherwise each grow their own
 * notion of which side changed, and the one that got it subtly wrong would accept a side the
 * author never chose, silently, in a file they will not re-read.
 *
 * Pure and total. `spec.merge3` is contractually not allowed to throw and runs in the main
 * process over documents that came out of a repository, so everything here is written for shapes
 * no current Studio would produce.
 */

/** What the merged map holds at one key, and how that was decided. */
export interface KeyedMergeRow<V> {
    readonly key: string;
    /** Absent from {@link KeyedMergeResult.rows} when both sides agree - there was nothing to decide. */
    readonly outcome: DocumentMergeDecision["outcome"];
    readonly mine: DocumentMergeSide;
    readonly theirs: DocumentMergeSide;
    /**
     * What the two sides started from, `present: false` for a key neither the base document held
     * nor - when there is no base document at all - could have held.
     *
     * Not forwarded onto {@link DocumentMergeDecision}, which is a choice between two sides. It is
     * here because a spec cannot word its own rows without it: "added" and "removed" are the same
     * observation from the other end, and only the base says which one happened.
     */
    readonly base: DocumentMergeSide;
    /** `undefined` = the merged document does not hold this key. */
    readonly merged: V | undefined;
}

export interface KeyedMergeResult<V> {
    /**
     * The merged map.
     *
     * **Key order is mine's, then the ids only theirs has, then the ids only base still has** -
     * an append, never an interleave and never a conflict. For a format where insertion order
     * is data (the asset shards: their key order IS the browser's row order, recovered import
     * order rather than anything the author arranged) this is the whole answer to "both sides
     * added assets": two imports append, and neither one renumbers the other's rows. For a
     * format serialized canonically the keys get sorted anyway and this costs nothing.
     */
    readonly merged: Record<string, V>;
    /** One row per key the two sides disagree about, in the merged map's order. */
    readonly rows: readonly KeyedMergeRow<V>[];
}

function side(present: boolean, value: unknown): DocumentMergeSide {
    return present ? {present: true, value} : {present: false};
}

function has(record: Readonly<Record<string, unknown>> | undefined, key: string): boolean {
    return record !== undefined && Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Three-way merge of one keyed collection.
 *
 * `base` is `undefined` for an add/add - the two sides made this document independently and share
 * no starting point. **Then nothing auto-merges.** It is tempting to treat that as an empty base,
 * because an empty base makes every key on both sides an addition and disjoint keys then merge
 * for free; the reason not to is that "the other side does not have this key" and "the other side
 * removed this key" are the same observation without a base, and an empty base silently reads
 * every one of them the first way. Nor is the document-level story reliable enough to infer from:
 * a missing base is also what an unreadable or absent common ancestor looks like, where removal
 * genuinely did happen. So an add/add is answered as conflicts, which is one of the cases
 * that is permanently unresolvable rather than a to-do.
 */
export function mergeKeyed<V>(
    base: Readonly<Record<string, V>> | undefined,
    mine: Readonly<Record<string, V>>,
    theirs: Readonly<Record<string, V>>,
): KeyedMergeResult<V> {
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const key of [...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base ?? {})]) {
        if (seen.has(key)) continue;
        seen.add(key);
        ordered.push(key);
    }

    const merged: Record<string, V> = {};
    const rows: KeyedMergeRow<V>[] = [];

    for (const key of ordered) {
        const inBase = has(base, key);
        const inMine = has(mine, key);
        const inTheirs = has(theirs, key);
        const baseValue = inBase ? (base as Record<string, V>)[key] : undefined;
        const mineValue = inMine ? mine[key] : undefined;
        const theirsValue = inTheirs ? theirs[key] : undefined;

        // Both sides say the same thing, including both saying nothing. No decision exists, so
        // no row: a surface that drew one would ask the author to choose between two identical
        // answers, which reads as a defect in the merge rather than as a merge with no work in it.
        if (inMine === inTheirs && (!inMine || sameJsonValue(mineValue, theirsValue))) {
            if (inMine) merged[key] = mineValue as V;
            continue;
        }

        const mineSide = side(inMine, mineValue);
        const theirsSide = side(inTheirs, theirsValue);
        const baseSide = side(inBase, baseValue);
        const mineUntouched = base !== undefined && inBase === inMine
            && (!inMine || sameJsonValue(baseValue, mineValue));
        const theirsUntouched = base !== undefined && inBase === inTheirs
            && (!inTheirs || sameJsonValue(baseValue, theirsValue));

        if (mineUntouched) {
            if (inTheirs) merged[key] = theirsValue as V;
            rows.push({key, outcome: "auto-theirs", mine: mineSide, theirs: theirsSide, base: baseSide, merged: theirsValue});
            continue;
        }
        if (theirsUntouched) {
            if (inMine) merged[key] = mineValue as V;
            rows.push({key, outcome: "auto-mine", mine: mineSide, theirs: theirsSide, base: baseSide, merged: mineValue});
            continue;
        }

        // Both sides moved, or there is no base to say which of them did. The merged document
        // holds base - mine when there is no base - so that it stays a complete, writable
        // document while the author has not decided, and so that stopping halfway never ships a
        // side nobody picked.
        let held: V | undefined;
        if (inBase) {
            held = baseValue as V;
            merged[key] = held;
        } else if (inMine) {
            held = mineValue as V;
            merged[key] = held;
        }
        rows.push({key, outcome: "conflict", mine: mineSide, theirs: theirsSide, base: baseSide, merged: held});
    }

    return {merged, rows};
}

/** Build a decision row, leaving out what there is nothing to put in. */
export function decision(
    path: readonly string[],
    row: Pick<KeyedMergeRow<unknown>, "outcome" | "mine" | "theirs">,
    options: {label?: string; subject?: string} = {},
): DocumentMergeDecision {
    return {
        path,
        outcome: row.outcome,
        ...(options.label ? {label: {key: options.label}} : {}),
        ...(options.subject ? {subject: options.subject} : {}),
        mine: row.mine,
        theirs: row.theirs,
    };
}

/** How many of a decision list the author still has to settle. */
export function countConflicts(decisions: readonly DocumentMergeDecision[]): number {
    return decisions.reduce((count, entry) => count + (entry.outcome === "conflict" ? 1 : 0), 0);
}
