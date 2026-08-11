import type { DocumentChange, DocumentChangeKind, DocumentDiff, DocumentDiffTier } from "@shared/documents/diff";
import type { TranslationKey, Translator } from "@shared/i18n";

/**
 * Turning a {@link DocumentDiff} into rows a surface can draw, without any surface in the picture.
 *
 * Everything that can be WRONG about that list is here rather than in the component drawing it:
 * how many rows fit, which ones survive the cap, how many were left out, and how a label made of a
 * translation key plus parameters becomes text. There are no component-render tests for most of
 * this codebase, so anything that decides behaviour has to be reachable without mounting anything.
 *
 * The list has one home now - the comparison tab's detail pane, through `presenters` - where it
 * used to have two. The version rail drew a second, denser copy under any file row an author
 * expanded; the rail lists files only as of this milestone, so the cap that rendering needed is
 * gone with it.
 *
 * Nothing here reads project data, so nothing here is gated on the freeze. A comparison is a read
 * by construction - it cannot write anything even in principle - and a frozen workspace is exactly
 * the state an author is in while they are trying to find out what a past version says.
 */

/** One line of a change list: a top-level change, or one of its children. */
export interface DocumentChangeRow {
    /** Stable within one list. Not derived from the path alone - two roots can share an empty one. */
    readonly key: string;
    /** 0 for a change, 1 for a child of one. The model is two levels deep and no deeper. */
    readonly depth: 0 | 1;
    readonly change: DocumentChange;
    /**
     * Children of this row that the list is not showing: the ones the producer already dropped
     * ({@link DocumentChange.truncated}) plus any this cap left out. Zero on a child row.
     */
    readonly truncated: number;
}

export interface DocumentChangeRowList {
    readonly rows: DocumentChangeRow[];
    /**
     * Leaf changes not on screen, counting what the producer dropped as well as what this cap did.
     *
     * The number an omission notice quotes. Zero means the rows really are the whole list, which is
     * the only condition under which a surface may stay silent.
     */
    readonly hidden: number;
    /** Everything the diff stands for - `DocumentDiff.total`, and the count "view all N" names. */
    readonly total: number;
}

/**
 * The rows for one document's changes, capped at `limit` ROWS.
 *
 * Truncates from the END of an already ordered list, never by picking: `buildDocumentDiff` has
 * already sorted whatever it was handed and cut it to the producer's budget, so cutting again from
 * the front here keeps the same discipline one step further down. Sorting anything at this layer
 * would undo it - the order a diff arrives in is a decision its producer made (conflicts first,
 * walk order for the structural tier), and a second opinion about it drawn from display data would
 * quietly reshuffle the rows the author is told are the important ones.
 *
 * A group whose header fits but whose children do not is kept with the children that fit and says
 * how many are missing, rather than being dropped: the author needs to know the group changed at
 * all. A group with NO room for children at all is still a header plus a count, for the same
 * reason.
 */
export function buildDocumentChangeRows(diff: DocumentDiff, limit: number): DocumentChangeRowList {
    const rows: DocumentChangeRow[] = [];
    let budget = Math.max(0, limit);
    let shownLeaves = 0;

    for (const change of diff.changes) {
        if (budget <= 0) {
            break;
        }
        const children = change.children ?? [];
        budget -= 1;
        const taken = Math.min(children.length, budget);
        rows.push({
            key: `${rows.length}:${change.path.join("/")}`,
            depth: 0,
            change,
            truncated: (change.truncated ?? 0) + (children.length - taken),
        });
        for (let index = 0; index < taken; index += 1) {
            rows.push({
                key: `${rows.length}:${children[index].path.join("/")}`,
                depth: 1,
                change: children[index],
                truncated: 0,
            });
        }
        budget -= taken;
        // A group stands for its children; a change with none stands for itself. Counted the way
        // `countDocumentChanges` counts, so `hidden` and `total` are measured on the same scale.
        shownLeaves += children.length > 0 ? taken : 1;
    }

    return { rows, hidden: Math.max(0, diff.total - shownLeaves), total: diff.total };
}

/** One change, ready to draw. */
export interface DocumentChangeLabelView {
    /** The row's leading text: the author's own word when the label does not already carry it. */
    readonly primary: string;
    /** The translated label, when {@link primary} is the subject instead. */
    readonly detail?: string;
    /**
     * The two values either side of the change, when the producer supplied them.
     *
     * Drawn by the surface as a pair rather than interpolated into a sentence: an arrow between two
     * values is not language, so no locale has to word "a became b" once per kind of thing that can
     * change - and a narrow column can truncate the value without truncating the sentence around it.
     */
    readonly from?: string;
    readonly to?: string;
}

/**
 * The one key whose `{name}` parameter is itself a translation key.
 *
 * `DocumentSummaryCount.key` is documented as "a stable identifier for the UI to translate", so a
 * summary row would otherwise print `audioTracks` at the author. Spelled out here and in
 * `vcs/diff/documentDiff.ts`; the two have to change together.
 */
const LABEL_SUMMARY_COUNT = "documentDiff.summary.count";

/** Where a count's own name is translated. Absent falls back to the raw identifier. */
const COUNT_NAME_PREFIX = "documentDiff.count.";

export type LabelTranslator = Pick<Translator, "t" | "has">;

/**
 * Read one change out loud.
 *
 * The producers hand back a key and parameters and never a sentence (see `shared/documents/diff.ts`),
 * so this is where the two become text - and the only place, which is what keeps a main-process
 * change list from carrying English into a zh catalogue.
 *
 * `subject` is the author's own word and is drawn beside the label, EXCEPT where the label already
 * carries it: a structural property's label is its name, and a title change's values are the two
 * titles. Printing it again there would show the author their own word twice on one row, and the
 * three parameters it can coincide with are named exactly rather than guessed at by substring.
 */
export function resolveDocumentChangeLabel(
    change: DocumentChange,
    translator: LabelTranslator,
): DocumentChangeLabelView {
    const params = change.label.params;
    const interpolated: Record<string, string | number> = { ...params };

    // Byte counts are the one parameter the author reads as a size rather than as a number. Formatted
    // here rather than in the producer, which has no locale and no idea how wide the column is.
    for (const key of ["bytes", "fromBytes", "toBytes"] as const) {
        const value = params?.[key];
        if (typeof value === "number") {
            interpolated[key] = formatBytes(value);
        }
    }
    if (change.label.key === LABEL_SUMMARY_COUNT && typeof params?.name === "string") {
        interpolated.name = translateCountName(params.name, translator);
    }

    // Cast because a producer's key is a plain string by contract - the diff model is shared with the
    // main process, which has no business importing a renderer's key union. A key with no entry
    // renders as itself, which is what makes a stale producer visible rather than blank.
    const text = translator.t(change.label.key as TranslationKey, interpolated);
    const from = params?.from === undefined ? undefined : String(params.from);
    const to = params?.to === undefined ? undefined : String(params.to);
    const subject = change.subject;
    const carriedByLabel = subject === undefined
        || subject === params?.name
        || subject === params?.from
        || subject === params?.to;

    return carriedByLabel
        ? { primary: text, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) }
        : {
            primary: subject,
            detail: text,
            ...(from === undefined ? {} : { from }),
            ...(to === undefined ? {} : { to }),
        };
}

function translateCountName(name: string, translator: LabelTranslator): string {
    const key = `${COUNT_NAME_PREFIX}${name}`;
    // `has` rather than letting `t` fall through: an untranslated key logs a warning once per key and
    // renders the dotted path, and a spec may well add a count before anyone translates it. The raw
    // identifier is a worse label than a translated one and a much better one than `documentDiff.count.x`.
    return translator.has(key) ? translator.t(key as TranslationKey) : name;
}

/**
 * Whether what happened is a fact about the whole file rather than a comparison of its insides.
 *
 * **Three kinds, and the third one was the miss.** A tier is a caveat about HOW two versions were
 * compared, so it only means anything where two versions were compared. A file that was added has
 * no other side; one that was removed has no other side; and one that MOVED has two sides holding
 * the same bytes - so there was nothing to look inside for, and its row is a fact rather than a
 * summary. Added and removed were spelled out at the two places that care; `moved` was in neither,
 * so a renamed note read "Not read" in the real app - false twice over, because a working-tree
 * rename is confirmed by reading both copies IN FULL (`vcs/diff/workingTreeDiff.ts`, `pairRenames`).
 *
 * The two places have to agree or the surface contradicts itself: the detail pane suppresses the
 * caption, and {@link import("./changeIndex").buildChangeIndex} leaves the same files out of the
 * count its group headings show. Spelling the kinds twice is what let them disagree, so they are
 * spelled here and nowhere else.
 *
 * Takes a kind rather than a whole entry, and the diff model's kind at that: a working-tree status
 * says `deleted` where this says `removed`, and passing that spelling has to be a compile error
 * rather than a quiet "not whole". `DocumentChangeList`'s own prop stays a boolean for the same
 * reason, one layer further out.
 */
export function isWholeDocumentChange(kind: DocumentChangeKind): boolean {
    return kind === "added" || kind === "removed" || kind === "moved";
}

/** The caption above a change list, or null for the one tier that needs no caveat. */
export interface DocumentDiffTierCaption {
    readonly key: TranslationKey;
    /** The longer explanation, for a `title`. A 320px rail has room for the first and not the second. */
    readonly hintKey: TranslationKey;
}

/**
 * What to say about HOW a diff was produced.
 *
 * `semantic` answers null, and that asymmetry is the point: it is the only tier whose rows mean what
 * they appear to mean, so it is the only one that may be drawn bare. Every other tier gets a line
 * above its rows, because a structural list of JSON paths and a semantic list of authored changes
 * are indistinguishable at a glance and are not the same claim (see `DocumentDiffTier`).
 */
export function documentDiffTierCaption(tier: DocumentDiffTier): DocumentDiffTierCaption | null {
    switch (tier) {
        case "semantic":
            return null;
        case "summary":
            return {
                key: "documentDiff.tier.summary" as TranslationKey,
                hintKey: "documentDiff.tier.summaryHint" as TranslationKey,
            };
        case "structural":
            return {
                key: "documentDiff.tier.structural" as TranslationKey,
                hintKey: "documentDiff.tier.structuralHint" as TranslationKey,
            };
        case "content":
            return {
                key: "documentDiff.tier.content" as TranslationKey,
                hintKey: "documentDiff.tier.contentHint" as TranslationKey,
            };
        case "opaque":
            return {
                key: "documentDiff.tier.opaque" as TranslationKey,
                hintKey: "documentDiff.tier.opaqueHint" as TranslationKey,
            };
    }
}

/**
 * What to say when a file the change list calls modified turns out to have no rows.
 *
 * A single "nothing differs inside this file" reads as a contradiction, and it was one:
 * measured in the real app, a project's `character.json` is listed as modified while its
 * semantic diff is empty, because opening the project rewrote the store into canonical
 * bytes without altering a single thing the editor models. The list said eight changed,
 * the expansion said nothing changed, and both were true - which is worse than either
 * being wrong, because the author has no way to tell that from a bug.
 *
 * So the message says what the tier can actually support:
 *
 *  - `structural` compared the parsed JSON and found it equal, so the bytes differ only in
 *    formatting or key order. That is a specific claim and it is safe to make.
 *  - `semantic` only ever knows that its own model is unchanged - the difference could be
 *    formatting, or a field the spec deliberately ignores. Claiming "only formatting"
 *    here would be a specific claim the spec has not earned.
 *  - `summary` compared counts. Equal counts are not an equal document, and saying so is
 *    the whole point of the tier being named.
 *  - `content` and `opaque` never produce an empty list, but the fallback stays honest
 *    rather than unreachable-by-assumption.
 */
export function documentDiffEmptyKey(tier: DocumentDiffTier): TranslationKey {
    switch (tier) {
        case "structural":
            return "documentDiff.rows.emptyFormatting" as TranslationKey;
        case "semantic":
            return "documentDiff.rows.emptyUntracked" as TranslationKey;
        case "summary":
            return "documentDiff.rows.emptyCounts" as TranslationKey;
        case "content":
        case "opaque":
            return "documentDiff.rows.empty" as TranslationKey;
    }
}

/**
 * The marker each kind of change wears, as one character.
 *
 * A glyph rather than an icon because these sit inside a row that already carries one for the FILE,
 * and two icon sets on one line read as two unrelated statuses. Tinted only where something is
 * gained or lost, which is the same rule the file list's own markers follow.
 */
export const CHANGE_KIND_GLYPH: Record<DocumentChange["kind"], string> = {
    added: "+",
    removed: "−",
    changed: "·",
    moved: "→",
};

export const CHANGE_KIND_TINT: Record<DocumentChange["kind"], string> = {
    added: "text-success",
    removed: "text-danger",
    changed: "text-fg-subtle",
    moved: "text-fg-subtle",
};

/**
 * A byte count the way the rest of Studio writes one (see the asset inspector's `formatSize`).
 *
 * The units are left untranslated deliberately and consistently with that surface: `KB` is read as a
 * unit symbol rather than as a word, and a locale that wanted its own would have to be given every
 * size in the app at once rather than only the ones a diff happens to mention.
 */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return "—";
    }
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
