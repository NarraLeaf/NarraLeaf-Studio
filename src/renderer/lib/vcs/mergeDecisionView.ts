import type { DocumentMergeDecision, DocumentMergeSide } from "@shared/documents/diff";
import { mergeDecisionKey, type DocumentMergeSideName } from "@shared/documents/mergeApply";
import type { TranslationKey } from "@shared/i18n";
import type {
    VcsMergeDocument,
    VcsMergeDocumentBlocker,
    VcsMergeSideChoice,
    VcsMergeState,
} from "@shared/types/vcs";
import type { LabelTranslator } from "./documentChangeView";
import { documentNameOf, type DocumentName, type DocumentNameContext } from "./documentName";

/**
 * Reading a three-way merge's decisions as rows, without a component in the picture.
 *
 * The same split `documentChangeView.ts` makes and for the same reason: there are no
 * component-render tests here, so everything that can be WRONG about the second tier - which side
 * a row is currently on, whether a file is finished, what a value looks like when it is an object,
 * which sentence a refusal gets - lives in functions that can be called without mounting anything.
 *
 * One rule runs through all of it. **A `conflict` with no recorded choice is not "mine" and not
 * "theirs" and must never resolve to either**. Two hundred
 * conflicts to click through is tedious; one mis-aimed press that silently discarded a
 * collaborator's day is worse, and unlike the tedium it leaves no trace.
 */

/** The author's choices inside one document, keyed by {@link mergeDecisionKey}. */
export type MergeChangeChoices = Readonly<Record<string, VcsMergeSideChoice>>;

/**
 * The side a row is on right now: the author's choice, else the one the merge already took.
 *
 * `undefined` only for an unanswered `conflict`, which is the state the finish button counts.
 */
export function effectiveMergeSide(
    decision: DocumentMergeDecision,
    choices: MergeChangeChoices,
): DocumentMergeSideName | undefined {
    const chosen = choices[mergeDecisionKey(decision.path)];
    if (chosen) {
        return chosen;
    }
    if (decision.outcome === "auto-mine") return "mine";
    if (decision.outcome === "auto-theirs") return "theirs";
    return undefined;
}

/** Conflicts in this document the author has not answered. Zero means it can be finished. */
export function countUndecidedChanges(
    decisions: readonly DocumentMergeDecision[],
    choices: MergeChangeChoices,
): number {
    let count = 0;
    for (const decision of decisions) {
        if (effectiveMergeSide(decision, choices) === undefined) {
            count += 1;
        }
    }
    return count;
}

/**
 * What one window knows about one conflicted document's insides.
 *
 * Read on demand - a decision carries BOTH sides' values verbatim, so a merge with two hundred
 * conflicted files fetched up front would be a message almost none of which is ever looked at.
 * `undefined` for a path nobody has opened, which is a fourth state and the one that decides
 * whether the per-change control may be offered at all.
 */
export type MergeDocumentEntry =
    | { readonly status: "loading" }
    | { readonly status: "error"; readonly message: string }
    | { readonly status: "ready"; readonly document: VcsMergeDocument };

/**
 * Everything a window has decided about a merge, and everywhere it exists.
 *
 * Nothing readable says which conflicts an author has already settled (docs §4.24), so this record
 * belongs to the window drawing it and is never presented as repository state. Read-only here: this
 * module answers questions about the choices and records none.
 */
export interface MergeChoiceState {
    /** Whole-file choices, keyed by repository-relative path. Absent means undecided. */
    readonly decisions: Readonly<Record<string, VcsMergeSideChoice>>;
    /**
     * Paths being settled change by change.
     *
     * Separate from {@link changeChoices}, because "this file is being merged" and "this change goes
     * to theirs" are different facts: a document whose every inner change merged automatically has
     * nothing to choose and still has to be marked as merged.
     */
    readonly perChange: Readonly<Record<string, true>>;
    readonly changeChoices: Readonly<Record<string, MergeChangeChoices>>;
    readonly documents: Readonly<Record<string, MergeDocumentEntry>>;
}

/** The answer a file has, or `none` - which is the state that stops the merge being finished. */
export type MergeFileDecision = VcsMergeSideChoice | "per-change" | "none";

/** One conflicted file, as the index draws it and as the finish button counts it. */
export interface ConflictRowView {
    /**
     * Where the merge reported this conflict. The address every verb takes, and NOT what the row
     * says: see {@link name}.
     */
    readonly path: string;
    /**
     * What the author calls the thing in conflict: a scene's title, an asset's name, the name of
     * its kind.
     *
     * The same four-state answer the comparison index carries, from the same module, because a
     * merge is the one surface where naming a file after its file name is worst: `storydoc.json`
     * twice over is the moment an author has to decide which of two versions of their work to keep.
     */
    readonly name: DocumentName;
    readonly decision: MergeFileDecision;
    /**
     * Whether this file has an answer the author gave.
     *
     * The one predicate behind both the row's marker and the finish button, so the two cannot
     * disagree about whether a merge can be closed.
     */
    readonly settled: boolean;
    /**
     * Whether this file may be settled change by change.
     *
     * False until the document has been READ, because that is a property of the document and not of
     * the interface: the control cannot be drawn before anyone has looked (see
     * {@link VcsMergeDocument.blocked}, which is the other half of the answer).
     */
    readonly mergeable: boolean;
    /** Conflicts inside it still needing a side. Zero for anything not being merged per change. */
    readonly undecidedChanges: number;
}

/**
 * `names` is required and has no default, for `buildChangeIndex`'s reason: a default would be a
 * quiet way back to file names, on the surface that can least afford one.
 */
export function buildConflictRows(
    paths: readonly string[],
    state: MergeChoiceState,
    names: DocumentNameContext,
): ConflictRowView[] {
    return paths.map(path => {
        const whole = state.decisions[path];
        const entry = state.documents[path];
        const document = entry?.status === "ready" ? entry.document : null;
        const mergeable = document !== null && document.blocked === undefined;
        const merging = state.perChange[path] === true;
        const undecidedChanges = mergeable && merging
            ? countUndecidedChanges(document.decisions, state.changeChoices[path] ?? {})
            : 0;
        return {
            path,
            name: documentNameOf(path, names),
            decision: whole ?? (merging ? "per-change" : "none"),
            // Per-change counts only when every `conflict` inside has a side; an `auto-*` row needs
            // nothing, because the merge already had a right answer for it. A blocked document can
            // never be settled this way, however many changes it reports.
            settled: whole !== undefined || (merging && mergeable && undecidedChanges === 0),
            mergeable,
            undecidedChanges,
        };
    });
}

/** Files still needing an answer. Counted over every conflict, not over the rows an index drew. */
export function countUndecidedFiles(rows: readonly ConflictRowView[]): number {
    return rows.reduce((count, row) => (row.settled ? count : count + 1), 0);
}

/**
 * One decision, read out loud.
 *
 * `label` is optional on the model and its absence is a real state, not a gap: a format whose merge
 * lands before its semantic diff has no vocabulary yet. **The fallback is the path itself, drawn as
 * the raw thing it is** - inventing a sentence here would put a translated-looking label on a row
 * nobody has words for, which is worse than an obviously untranslated one because it cannot be
 * spotted.
 */
export interface MergeDecisionLabelView {
    /** The row's leading text: the author's own word where there is one, else the translated label. */
    readonly primary: string;
    /** The translated label, when {@link primary} is the subject. */
    readonly detail?: string;
    /** True when {@link primary} is a path rather than anything anyone wrote or translated. */
    readonly untranslated: boolean;
}

export function resolveMergeDecisionLabel(
    decision: DocumentMergeDecision,
    translator: LabelTranslator,
): MergeDecisionLabelView {
    if (!decision.label) {
        return {
            primary: decision.subject ?? decision.path.join(" / "),
            untranslated: decision.subject === undefined,
        };
    }
    // Cast for `resolveDocumentChangeLabel`'s reason: a producer's key is a plain string by
    // contract, and one with no entry renders as itself rather than as nothing.
    const text = translator.t(decision.label.key as TranslationKey, { ...decision.label.params });
    return decision.subject === undefined
        ? { primary: text, untranslated: false }
        : { primary: decision.subject, detail: text, untranslated: false };
}

/** How many fields of one side's value a row draws before it says how many it left out. */
export const MERGE_VALUE_FIELD_LIMIT = 4;

/** Longest one field's text may be before it is cut. Two of these sit side by side in one row. */
export const MERGE_VALUE_TEXT_LIMIT = 160;

/** One line of a side's value: a field name where there is one, and its text. */
export interface MergeValueLine {
    readonly name?: string;
    readonly text: string;
}

/**
 * What one side holds, as lines.
 *
 * **Fields, not JSON.** A decision is taken on one entry of a keyed collection, so the value is a
 * record - a translation unit, an asset's metadata, a row of a script - and the question the author
 * is answering is which of two `target` strings to keep. Printing
 * `{"target":"你好","status":"translated",…}` puts the answer inside punctuation; one line per field
 * puts the two translations opposite each other, which is the act of choosing.
 *
 * Nothing is filtered by name. A heuristic that promoted "the important field" would be inventing
 * an opinion about formats this module does not know, and the field it dropped would be the one
 * that mattered.
 *
 * `absent` is its own state and not an empty list: "the other side does not have this entry" is a
 * real answer to a merge and taking that side deletes it.
 */
export interface MergeValueView {
    readonly absent: boolean;
    readonly lines: readonly MergeValueLine[];
    /** Fields past {@link MERGE_VALUE_FIELD_LIMIT}. Non-zero obliges the row to say so. */
    readonly hidden: number;
}

/**
 * How far into a value the field names go before what is left becomes one line of JSON.
 *
 * Deep enough for the shape these documents actually have. A story row's payload keeps the line the
 * author wrote at `text.value`, one level below the fields that say what kind of row it is, so a
 * flattening that stopped at the top would put the only thing worth reading inside the braces it is
 * meant to be taken out of. Bounded, because a name long enough to need its own line is no longer
 * telling the author where they are.
 */
export const MERGE_VALUE_MAX_DEPTH = 3;

/**
 * Both sides of one decision, as two lists that line up.
 *
 * **Described together, which is the whole point of the function taking two arguments.** Two sides
 * described apart list whatever fields each happens to hold, in whatever order each happens to be
 * built in, so the two columns of a chooser stop being rows of each other: `status` on the left sits
 * opposite `target` on the right, and the author compares two things that are not the same thing.
 * One field list, in one order, drawn by both.
 *
 * **The fields the two sides disagree about come first.** A decision exists because the sides
 * differ; the fields they agree on are the part that is not the question, and leading with them
 * pushes the answer past the row's limit on exactly the documents whose payload carries its identity
 * at the top and its content underneath. A field one side does not have counts as a disagreement,
 * because taking the other side adds or removes it.
 *
 * The remaining order is the order the value states, first side first: within "differs" and within
 * "agrees", nothing here reorders what the document says.
 */
export function describeMergeSides(
    mine: DocumentMergeSide,
    theirs: DocumentMergeSide,
): { readonly mine: MergeValueView; readonly theirs: MergeValueView } {
    const ABSENT: MergeValueView = { absent: true, lines: [], hidden: 0 };
    if (!mine.present && !theirs.present) {
        return { mine: ABSENT, theirs: ABSENT };
    }

    const flat = flattenPair(
        mine.present ? { value: mine.value } : null,
        theirs.present ? { value: theirs.value } : null,
    );
    const differs = (name: string) => flat.mine.get(name) !== flat.theirs.get(name);
    const ordered = [...flat.names.filter(differs), ...flat.names.filter(name => !differs(name))];
    const shown = ordered.slice(0, MERGE_VALUE_FIELD_LIMIT);
    const hidden = Math.max(0, ordered.length - shown.length);

    const view = (fields: ReadonlyMap<string, string>, present: boolean): MergeValueView => {
        if (!present) {
            return ABSENT;
        }
        return {
            absent: false,
            // A name a side does not hold draws as an empty value rather than as a missing row: the
            // two columns have to stay rows of each other, and "this side has nothing here" is the
            // fact the author is choosing about.
            lines: shown.map(name => ({ ...(name ? { name } : {}), text: fields.get(name) ?? "" })),
            hidden,
        };
    };
    return {
        mine: view(flat.mine, mine.present),
        theirs: view(flat.theirs, theirs.present),
    };
}

/** A value that is there, as distinct from a name neither side reaches. */
interface Held {
    readonly value: unknown;
}

/**
 * Both values as named fields, walked in step.
 *
 * **In step, not one after the other.** Two values flattened apart produce two name lists that have
 * to be reconciled afterwards, and they cannot be: a side holding `tags: {}` and a side holding
 * `tags: {a: 1}` end up with the names `tags` and `tags.a`, and each column then draws a blank
 * where the other has a value, saying that a side which does hold `tags` does not. Walked together,
 * a name stops being split the moment either side has nothing left to split, so the two columns are
 * always the same names and the same rows.
 *
 * A scalar answers with the single nameless entry the row draws bare - there is no field to name
 * when the value IS the field. Everything else descends: objects by key, arrays by index, joined
 * with dots, to {@link MERGE_VALUE_MAX_DEPTH}. An empty object or array is a leaf rather than
 * nothing, because "this side holds an empty list" is a state and drawing no line for it would read
 * as the side not holding the field at all.
 */
function flattenPair(mine: Held | null, theirs: Held | null): {
    readonly names: string[];
    readonly mine: ReadonlyMap<string, string>;
    readonly theirs: ReadonlyMap<string, string>;
} {
    const names: string[] = [];
    const mineFields = new Map<string, string>();
    const theirsFields = new Map<string, string>();

    const walk = (left: Held | null, right: Held | null, name: string, depth: number): void => {
        const leftChildren = left ? childEntries(left.value) : null;
        const rightChildren = right ? childEntries(right.value) : null;
        const splits = (held: Held | null, children: ReturnType<typeof childEntries>) =>
            held === null || (children !== null && children.length > 0);
        if (depth >= MERGE_VALUE_MAX_DEPTH
            || !splits(left, leftChildren)
            || !splits(right, rightChildren)) {
            names.push(name);
            if (left) mineFields.set(name, scalarText(left.value));
            if (right) theirsFields.set(name, scalarText(right.value));
            return;
        }
        const keys: string[] = [];
        for (const [key] of [...(leftChildren ?? []), ...(rightChildren ?? [])]) {
            if (!keys.includes(key)) {
                keys.push(key);
            }
        }
        const at = (children: ReturnType<typeof childEntries>, key: string): Held | null => {
            const found = children?.find(entry => entry[0] === key);
            return found ? { value: found[1] } : null;
        };
        for (const key of keys) {
            walk(at(leftChildren, key), at(rightChildren, key), name ? `${name}.${key}` : key, depth + 1);
        }
    };

    walk(mine, theirs, "", 0);
    return { names, mine: mineFields, theirs: theirsFields };
}

/** The named children of a value, or null for something with none to descend into. */
function childEntries(value: unknown): (readonly [string, unknown])[] | null {
    if (value === null || typeof value !== "object") {
        return null;
    }
    return Array.isArray(value)
        ? value.map((element, index) => [String(index), element] as const)
        : Object.entries(value as Record<string, unknown>);
}

/**
 * One field as text.
 *
 * A value too deep to keep naming collapses to compact JSON rather than to a placeholder: "{…}"
 * would tell the author the two sides differ somewhere they cannot see.
 */
function scalarText(value: unknown): string {
    const text = typeof value === "string" ? value
        : value === undefined ? ""
            : JSON.stringify(value) ?? String(value);
    return text.length > MERGE_VALUE_TEXT_LIMIT ? `${text.slice(0, MERGE_VALUE_TEXT_LIMIT - 1)}…` : text;
}

/**
 * Why one document has no per-change list - one sentence per wall, never a missing control.
 *
 * Plan §4.2's third tier is "refuse and say why", and this is the whole of the saying. A surface
 * that omitted the row for a blocked document would draw "Studio cannot merge this format" and
 * "there is nothing left to decide here" as the same blank space, and the author's only way to
 * tell them apart would be to finish the merge and look at the file.
 */
/**
 * What the resolve panel's strip says about the merge it is showing.
 *
 * **A surface may not go on asserting a state it can see has ended.** The strip used to name the
 * merge unconditionally, so an author who had just finished one was left reading "the two versions
 * of this project are being merged" directly above the panel's own body reporting - correctly -
 * that no merge is in progress. One screen, two answers, and the wrong one on top.
 *
 * Where there is no merge it falls back to the panel's own name, which asserts nothing. That is
 * also the right answer BEFORE the first read comes back, and the reason this takes the state
 * rather than a boolean: `null` is "nobody has asked yet", and collapsing it into "there is none"
 * would put a claim on screen that is merely likely.
 */
export function mergeHeadingKey(state: VcsMergeState | null): TranslationKey {
    return (state?.inProgress
        ? "documentDiff.resolve.merging"
        : "documentDiff.resolve.tab") as TranslationKey;
}

export function mergeDocumentBlockedKey(blocker: VcsMergeDocumentBlocker): TranslationKey {
    switch (blocker) {
        case "no-spec":
            return "documentDiff.resolve.change.blocked.noSpec" as TranslationKey;
        case "no-merge3":
            return "documentDiff.resolve.change.blocked.noMerge3" as TranslationKey;
        case "read-only":
            return "documentDiff.resolve.change.blocked.readOnly" as TranslationKey;
        case "too-large":
            return "documentDiff.resolve.change.blocked.tooLarge" as TranslationKey;
        case "too-many":
            return "documentDiff.resolve.change.blocked.tooMany" as TranslationKey;
        case "unreadable":
            return "documentDiff.resolve.change.blocked.unreadable" as TranslationKey;
    }
}
