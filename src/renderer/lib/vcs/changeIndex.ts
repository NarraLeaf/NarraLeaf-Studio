import {
    countDocumentChanges,
    type DocumentChange,
    type DocumentChangeKind,
    type DocumentDiffEntry,
    type DocumentDiffTier,
} from "@shared/documents/diff";
import type { TranslationKey } from "@shared/i18n";
import { joinAssetEntries, type ChangeIndexUnit } from "./assetRows";
import { CHANGE_CATEGORY_ORDER, changeCategoryOf, type ChangeCategory } from "./changeCategory";
import { isWholeDocumentChange } from "./documentChangeView";

/**
 * A comparison as something to navigate rather than something to read end to end.
 *
 * The tab used to draw every document expanded, one under the next, with every change under each of
 * those. Forty changed files were forty sections and a thousand rows in one scroller, and the first
 * question an author has - "did anything happen to the story?" - could only be answered by scrolling
 * past the assets. This builds the other half of the answer: headings, and one line per file.
 *
 * **One line per thing the author has a name for, whatever is inside it.** That is one file for
 * almost everything, and one ASSET where an asset is stored as a record in a shard plus a file of
 * bytes - `assetRows.ts` folds those two back together before anything here counts them. Nothing
 * here knows about tiers, labels or values;
 * that is the detail pane's business, and the moment an index row can grow with what it stands for,
 * the index is a report again. Everything a group needs to be honest about - how a file was compared,
 * what was left out - is summed onto the GROUP, once, rather than repeated onto every row.
 *
 * No React, so it can be tested without mounting anything, which is the same reason
 * `documentChangeView.ts` is a module of its own.
 */

/** One file or one asset, as one line. Holds nothing that could render as a second line. */
export interface ChangeIndexRow {
    /**
     * What the selection is on. **Not a path, and not an address.**
     *
     * The path used to be both, and it stopped being able to be: an asset is drawn as one row and is
     * stored as a record inside a shard plus a file of bytes (`assetRows.ts`), so several rows of one
     * comparison share the shard's path. A handle of its own is what lets {@link path} go on meaning
     * the file this row is reported at. It lives and dies with this pane - nothing writes it down,
     * and no producer, merger or resolver has ever seen it.
     */
    readonly key: string;
    /** The document path: where the comparison reported this row. Not unique across rows. */
    readonly path: string;
    /** The file name, or the name the author gave the asset. What identifies this row. */
    readonly name: string;
    /**
     * What to call this row instead of {@link name}, when its own file name says nothing.
     *
     * A translation KEY rather than a sentence, for the reason a change label is one: there is no
     * locale in this module. Only a content file that no asset record claims has one.
     */
    readonly nameKey?: TranslationKey;
    /** Where it sits, or null at the project root. Shown dimmed beside the name, never instead. */
    readonly directory: string | null;
    /** What happened to the file itself, as opposed to what changed inside it. */
    readonly kind: DocumentChangeKind;
    /** Changes this file stands for - `DocumentDiff.total`, including any the producer dropped. */
    readonly changeCount: number;
    /**
     * Whether what happened is a fact about the whole file - see {@link isWholeDocumentChange}.
     *
     * A count is the wrong thing to say about one: an added file is reported as a single change
     * (there is nothing to compare it against), and "1 change" for a new chapter is a worse answer
     * than "Added". `changeIndexRowSummary` already words all three that way.
     */
    readonly wholeDocument: boolean;
    /**
     * Files this ONE row stands for, when the document is stored as several files.
     *
     * Zero for the ordinary document, which is one file and has nothing to add. Above zero for a
     * document set (`@shared/documents/documentSet.ts`), where {@link path} is the manifest and the
     * files that changed are its members - so the name on the row is sometimes a file that did not
     * itself change. One for an asset whose bytes were replaced, where the second file is the
     * content shard {@link member} points at.
     *
     * **The row still stays one line.** The count belongs in the tooltip beside the path, not on a
     * second line and not as a nested list: the moment a row can grow with what it stands for the
     * index is a report again, which is the failure this layout is a fix for. It is carried at all
     * because the alternative is silence, and an author who believes one file changed when forty
     * did will stop trusting every other number on this surface.
     */
    readonly memberCount: number;
    /** The entry itself, for the detail pane. Carried rather than re-looked-up by path. */
    readonly entry: DocumentDiffEntry;
    /**
     * The one record inside {@link entry} this row stands for, when the row is an asset.
     *
     * Absent for an ordinary document, whose row stands for the whole file. Present, the detail
     * pane scopes itself to this change rather than drawing every asset in the shard.
     */
    readonly change?: DocumentChange;
    /**
     * The file holding this row's bytes, when they are not in {@link entry} itself.
     *
     * An asset's contents are stored under its id rather than beside its record, so the picture,
     * the sound or the typeface a row is about is in a different file from the one the row is
     * reported at. A presenter that shows the file rather than describing it reads THIS one.
     */
    readonly member?: DocumentDiffEntry;
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
     * may carry up to `DIFF_UNIT_LIMIT` (2000) documents, which is a first commit or a bulk import
     * rather than an edit. **Documents rather than files**, since one of them can be several files -
     * which is what keeps a project made of chunked stories from arriving here as one row per scene.
     */
    readonly rowBudget: number;
    /** Overrides {@link GROUP_COLLAPSE_THRESHOLD}; the tests set it, the tab does not. */
    readonly collapseThreshold?: number;
    /**
     * Whether the comparison listed every document that changed. Defaults to false.
     *
     * Passed straight through to {@link joinAssetEntries}, where it decides whether a content file
     * with no record beside it may be called one. Defaulting to false rather than true is the whole
     * point: a caller that has not said cannot have its silence read as a guarantee.
     */
    readonly complete?: boolean;
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
    // Folded before anything is counted, so the budget is spent on lines an author will see and a
    // group heading counts the same things its rows are.
    const units = joinAssetEntries(entries, { complete: options.complete ?? false });
    const listed = units.slice(0, budget);

    const byCategory = new Map<ChangeCategory, ChangeIndexRow[]>();
    const tiersByCategory = new Map<ChangeCategory, Set<DocumentDiffTier>>();
    const partialByCategory = new Map<ChangeCategory, number>();

    for (const unit of listed) {
        const category = changeCategoryOf(unit.entry);
        const rows = byCategory.get(category) ?? [];
        rows.push(indexRow(unit));
        byCategory.set(category, rows);

        // The tier set is the evidence behind the count and is gated on the same answer, so a
        // group cannot report a caveat's tier while reporting nothing to caveat about.
        const shortfall = comparisonsBehind(unit).filter(isPartial);
        for (const compared of shortfall) {
            if (compared.diff.tier !== "semantic") {
                const tiers = tiersByCategory.get(category) ?? new Set<DocumentDiffTier>();
                tiers.add(compared.diff.tier);
                tiersByCategory.set(category, tiers);
            }
        }
        // Once per ROW, however many files that row stands for: the number under a heading is read
        // as "this many lines here are not the whole story", and it counts lines.
        if (shortfall.length > 0) {
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
        omitted: Math.max(0, units.length - listed.length),
    };
}

/**
 * Whether this file's changes are described in full.
 *
 * Two unrelated shortfalls, one answer, because the author's next move is the same for both: a diff
 * below the semantic tier did not read the document as the format it is, and an incomplete one did
 * but stopped early.
 *
 * **A file that appeared, disappeared or moved is neither**, however weak the tier on it reads. The
 * engine reports one of those as a single `opaque` row because there is no second side to compare
 * against, not because it gave up - so counting it as "not compared in full" says a comparison fell
 * short where none was owed. Measured: a 26-byte new `.txt`, described perfectly in its own detail,
 * counted in a group heading that read "2 files here were not compared in full". Same judgement as
 * the detail pane's, from the same predicate, so the two cannot drift apart again.
 */
function isPartial(entry: DocumentDiffEntry): boolean {
    if (isWholeDocumentChange(entry.kind)) {
        return false;
    }
    return entry.diff.tier !== "semantic" || !entry.diff.complete;
}

/**
 * The comparisons a row's caveat is about.
 *
 * An ordinary row stands for one comparison of one file and answers with it. An asset row stands
 * for two files compared separately, and only one of them can have fallen short: the metadata half
 * is read record by record, at the semantic tier and in full - `joinAssetEntries` declines to split
 * a shard that is none of those - so what is left to caveat about is how the BYTES were compared,
 * which for a content file with no extension is a header read at best. An asset whose bytes did not
 * change has no second file and nothing to say.
 */
function comparisonsBehind(unit: ChangeIndexUnit): readonly DocumentDiffEntry[] {
    if (unit.change) {
        return unit.member ? [unit.member] : [];
    }
    return [unit.entry];
}

function indexRow(unit: ChangeIndexUnit): ChangeIndexRow {
    const { entry, change, member } = unit;
    const { directory, name } = splitDocumentPath(entry.path);
    // The record's own kind, never the file's: an asset added to a shard that was merely changed is
    // an addition, and the shard's `changed` would draw it as an edit of something already there.
    const kind = change?.kind ?? entry.kind;
    return {
        key: unit.key,
        path: entry.path,
        name: unit.name ?? name,
        ...(unit.nameKey ? { nameKey: unit.nameKey } : {}),
        directory,
        kind,
        changeCount: change ? countDocumentChanges([change]) : entry.diff.total,
        wholeDocument: isWholeDocumentChange(kind),
        // One for a joined asset - the file its bytes are in - and the producer's own count for a
        // document stored as several files. Never both: no document set is stored as an asset.
        memberCount: member ? 1 : entry.members?.length ?? 0,
        entry,
        ...(change ? { change } : {}),
        ...(member ? { member } : {}),
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
