import type { DocumentChangeKind, DocumentDiffEntry, DocumentDiffTier } from "@shared/documents/diff";
import { CHANGE_CATEGORY_ORDER, changeCategoryOf, type ChangeCategory } from "./changeCategory";

/**
 * A comparison as something to navigate rather than something to read end to end.
 *
 * The tab used to draw every document expanded, one under the next, with every change under each of
 * those. Forty changed files were forty sections and a thousand rows in one scroller, and the first
 * question an author has - "did anything happen to the story?" - could only be answered by scrolling
 * past the assets. This builds the other half of the answer: headings, and one line per file.
 *
 * **One line per file, whatever is inside it.** Nothing here knows about tiers, labels or values;
 * that is the detail pane's business, and the moment an index row can grow with what it stands for,
 * the index is a report again. Everything a group needs to be honest about - how a file was compared,
 * what was left out - is summed onto the GROUP, once, rather than repeated onto every row.
 *
 * No React, so it can be tested without mounting anything, which is the same reason
 * `documentChangeView.ts` is a module of its own.
 */

/** One file, as one line. Deliberately holds nothing that could render as a second line. */
export interface ChangeIndexRow {
    /** The document path: unique within a comparison, so it is also the selection handle. */
    readonly path: string;
    /** The file name - what identifies a document in this project. */
    readonly name: string;
    /** Where it sits, or null at the project root. Shown dimmed beside the name, never instead. */
    readonly directory: string | null;
    /** What happened to the file itself, as opposed to what changed inside it. */
    readonly kind: DocumentChangeKind;
    /** Changes this file stands for - `DocumentDiff.total`, including any the producer dropped. */
    readonly changeCount: number;
    /**
     * Whether the file appeared or disappeared whole.
     *
     * A count is the wrong thing to say about one: an added file is reported as a single change
     * (there is nothing to compare it against), and "1 change" for a new chapter is a worse answer
     * than "Added".
     */
    readonly wholeDocument: boolean;
    /** The entry itself, for the detail pane. Carried rather than re-looked-up by path. */
    readonly entry: DocumentDiffEntry;
}

/**
 * What is true of a whole group that a row must not repeat.
 *
 * The rule this type exists to enforce: a caveat is stated once per group or once per detail, never
 * once per line. A hundred asset records compared by size alone are one sentence, and drawing that
 * sentence a hundred times is how the old list became unreadable.
 */
export interface ChangeIndexCaveats {
    /**
     * The non-semantic tiers present in this group, deduped, in {@link CAVEAT_TIER_ORDER}.
     *
     * Kept as the evidence behind {@link partialDocuments} rather than rendered as a list: which
     * tier answered is a fact about one file and is stated in that file's detail, where there is
     * room to say what it means.
     */
    readonly tiers: readonly DocumentDiffTier[];
    /**
     * Files in this group that are not described in full: compared below the semantic tier, or
     * carrying a change list that was cut short. One number, because the author's next move is the
     * same for both - open the file and read what its detail says.
     */
    readonly partialDocuments: number;
}

export interface ChangeIndexGroup {
    readonly category: ChangeCategory;
    readonly rows: readonly ChangeIndexRow[];
    /**
     * Rows in this group, which is also the number its heading shows.
     *
     * Files rather than changes, deliberately: the number beside a heading is read as "this is what
     * opening it will cost me", and a heading that says 200 over a group that opens to three lines
     * teaches the author to distrust every other number on the surface.
     */
    readonly count: number;
    /** Whether the group starts closed. See {@link GROUP_COLLAPSE_THRESHOLD}. */
    readonly collapsed: boolean;
    readonly caveats: ChangeIndexCaveats;
}

export interface ChangeIndex {
    /** Non-empty groups only, in {@link CHANGE_CATEGORY_ORDER}. */
    readonly groups: readonly ChangeIndexGroup[];
    /** Every row across every group, in group order. The selection moves along this list. */
    readonly rows: readonly ChangeIndexRow[];
    /**
     * Files the budget left out entirely.
     *
     * Stated once for the whole index rather than per group, and never silently: a list that stops
     * at its limit with nothing said is read as the complete list.
     */
    readonly omitted: number;
}

/**
 * Files a group may hold before it starts closed.
 *
 * Twelve is what fits beside the file it is describing without the next heading falling off the
 * bottom. Past that the heading plus its count is more useful than the rows, because a group that
 * large is one an author opens on purpose - and a 200-file group left open costs 200 lines that
 * nobody asked for, which is the failure this whole layout is a fix for.
 */
export const GROUP_COLLAPSE_THRESHOLD = 12;

/** Weakest last, so a group's evidence reads in a stable order rather than in arrival order. */
const CAVEAT_TIER_ORDER: readonly DocumentDiffTier[] = ["semantic", "summary", "structural", "opaque"];

export interface BuildChangeIndexOptions {
    /**
     * Files the index will list before it stops adding them.
     *
     * The index is not virtualised, and this is what makes that safe rather than lucky: a comparison
     * may carry up to `DIFF_PATH_LIMIT` (2000) documents, which is a first commit or a bulk import
     * rather than an edit.
     */
    readonly rowBudget: number;
    /** Overrides {@link GROUP_COLLAPSE_THRESHOLD}; the tests set it, the tab does not. */
    readonly collapseThreshold?: number;
}

/**
 * Group a comparison for the index pane.
 *
 * The budget is spent in ARRIVAL order, before grouping, and that order is the main process's:
 * conflicts first, then path ascending. Grouping afterwards means the budget cannot reorder the
 * comparison - the files that survive are the ones the author's own tree lists first, not the ones
 * that happened to fall in a small category.
 */
export function buildChangeIndex(
    entries: readonly DocumentDiffEntry[],
    options: BuildChangeIndexOptions,
): ChangeIndex {
    const budget = Math.max(0, options.rowBudget);
    const threshold = options.collapseThreshold ?? GROUP_COLLAPSE_THRESHOLD;
    const listed = entries.slice(0, budget);

    const byCategory = new Map<ChangeCategory, ChangeIndexRow[]>();
    const tiersByCategory = new Map<ChangeCategory, Set<DocumentDiffTier>>();
    const partialByCategory = new Map<ChangeCategory, number>();

    for (const entry of listed) {
        const category = changeCategoryOf(entry);
        const rows = byCategory.get(category) ?? [];
        rows.push(indexRow(entry));
        byCategory.set(category, rows);

        if (entry.diff.tier !== "semantic") {
            const tiers = tiersByCategory.get(category) ?? new Set<DocumentDiffTier>();
            tiers.add(entry.diff.tier);
            tiersByCategory.set(category, tiers);
        }
        if (isPartial(entry)) {
            partialByCategory.set(category, (partialByCategory.get(category) ?? 0) + 1);
        }
    }

    const groups: ChangeIndexGroup[] = [];
    for (const category of CHANGE_CATEGORY_ORDER) {
        const rows = byCategory.get(category);
        if (!rows || rows.length === 0) {
            continue;
        }
        const tiers = tiersByCategory.get(category) ?? new Set<DocumentDiffTier>();
        groups.push({
            category,
            rows,
            count: rows.length,
            collapsed: rows.length > threshold,
            caveats: {
                tiers: CAVEAT_TIER_ORDER.filter(tier => tiers.has(tier)),
                partialDocuments: partialByCategory.get(category) ?? 0,
            },
        });
    }

    return {
        groups,
        rows: groups.flatMap(group => group.rows),
        omitted: Math.max(0, entries.length - listed.length),
    };
}

/**
 * Whether this file's changes are described in full.
 *
 * Two unrelated shortfalls, one answer, because the author's next move is the same for both: a diff
 * below the semantic tier did not read the document as the format it is, and an incomplete one did
 * but stopped early.
 */
function isPartial(entry: DocumentDiffEntry): boolean {
    return entry.diff.tier !== "semantic" || !entry.diff.complete;
}

function indexRow(entry: DocumentDiffEntry): ChangeIndexRow {
    const { directory, name } = splitDocumentPath(entry.path);
    return {
        path: entry.path,
        name,
        directory,
        kind: entry.kind,
        changeCount: entry.diff.total,
        wholeDocument: entry.kind === "added" || entry.kind === "removed",
        entry,
    };
}

/**
 * A path split the way the version rail splits it: the file name identifies a document in this
 * project, the directory merely locates it.
 *
 * Spelled here rather than imported from the rail's model, because this module has no React and no
 * workspace in it and importing a layout component's helper would give it both.
 */
export function splitDocumentPath(path: string): { directory: string | null; name: string } {
    const normalized = path.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
    const cut = normalized.lastIndexOf("/");
    if (cut < 0) {
        return { directory: null, name: normalized };
    }
    return { directory: normalized.slice(0, cut), name: normalized.slice(cut + 1) };
}
