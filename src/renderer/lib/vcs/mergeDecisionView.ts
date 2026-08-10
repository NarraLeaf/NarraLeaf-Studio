import type { DocumentMergeDecision, DocumentMergeSide } from "@shared/documents/diff";
import { mergeDecisionKey, type DocumentMergeSideName } from "@shared/documents/mergeApply";
import type { TranslationKey } from "@shared/i18n";
import type { VcsMergeDocumentBlocker, VcsMergeSideChoice } from "@shared/types/vcs";
import type { LabelTranslator } from "./documentChangeView";

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
 * record - a translation unit, an asset's metadata - and the question the author is answering is
 * which of two `target` strings to keep. Printing `{"target":"你好","status":"translated",…}` puts
 * the answer inside punctuation; one line per field puts the two translations opposite each other,
 * which is the act of choosing.
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

export function describeMergeSide(side: DocumentMergeSide): MergeValueView {
    if (!side.present) {
        return { absent: true, lines: [], hidden: 0 };
    }
    const value = side.value;
    if (value === null || typeof value !== "object") {
        return { absent: false, lines: [{ text: scalarText(value) }], hidden: 0 };
    }
    const entries = Array.isArray(value)
        ? value.map((element, index) => [String(index), element] as const)
        : Object.entries(value as Record<string, unknown>);
    const lines = entries.slice(0, MERGE_VALUE_FIELD_LIMIT).map(([name, element]) => ({
        name,
        text: scalarText(element),
    }));
    return { absent: false, lines, hidden: Math.max(0, entries.length - lines.length) };
}

/**
 * One field as text.
 *
 * A nested object collapses to compact JSON rather than to a placeholder: it is rare in these
 * formats, and "{…}" would tell the author the two sides differ somewhere they cannot see.
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
