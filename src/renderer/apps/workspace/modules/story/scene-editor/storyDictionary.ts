import type { StoryRichRun } from "@shared/types/story";
import type { DictionaryMatch, DictionaryNeedle } from "@shared/dictionary/dictionaryMatch";
import { matchDictionaryNeedles } from "@shared/dictionary/dictionaryMatch";
import { buildSpellcheckText } from "./storySpellcheck";

/**
 * The project dictionary, read against the row being edited.
 *
 * The sibling of `storySpellcheck`, and deliberately shaped like it: the same plain string, the same
 * unit map, the same refusal to shift a mark to follow the word it was made for. What differs is
 * where the answer comes from. A misspelling is decided in the main process against a word list of a
 * hundred thousand entries and arrives late; this is decided here, against a list the author wrote,
 * and is therefore recomputed outright on every edit rather than pruned and re-asked. There is no
 * staleness to guard against because there is no round trip.
 *
 * Comments in English per project convention.
 */

/** One thing the dictionary has to say about the row, placed in the editor's unit model. */
export type DictionaryMark = DictionaryMatch & {
    /** Unit offset of the first character, for `createUnitRange` and for splicing. */
    unitStart: number;
    /** Unit offset one past the last character. */
    unitEnd: number;
};

/**
 * Everything the dictionary has to say about these runs.
 *
 * Readings are asked about the ruby already on the row, which is why this reads the runs rather than
 * a string: a term the author has annotated by hand needs no suggestion, and offering one there
 * would mark every correctly annotated occurrence in the script.
 */
export function dictionaryMarks(
    runs: readonly StoryRichRun[],
    needles: readonly DictionaryNeedle[],
): DictionaryMark[] {
    if (needles.length === 0) {
        return [];
    }
    const { text, unitAt, rubyAt } = buildSpellcheckText(runs);
    if (text.trim() === "") {
        return [];
    }
    const matches = matchDictionaryNeedles(text, needles, (start, end) => {
        for (let index = start; index < end; index += 1) {
            if (rubyAt[index]) {
                return true;
            }
        }
        return false;
    });

    const marks: DictionaryMark[] = [];
    for (const match of matches) {
        // The same refusal `markFromRange` makes: a range that does not describe this text is not a
        // near miss to be clamped, and a clamped version of it would mark a stretch chosen at random.
        if (match.end >= unitAt.length) {
            continue;
        }
        marks.push({ ...match, unitStart: unitAt[match.start], unitEnd: unitAt[match.end] });
    }
    return marks;
}

/** The mark the pointer is standing in, or `null`. Both edges count, so the ends of a term are hit. */
export function dictionaryMarkAtUnit(marks: readonly DictionaryMark[], unit: number): DictionaryMark | null {
    return marks.find(mark => unit >= mark.unitStart && unit <= mark.unitEnd) ?? null;
}

/** Whether two answers say the same thing, so an unchanged row costs no re-measure and no render. */
export function sameDictionaryMarks(left: readonly DictionaryMark[], right: readonly DictionaryMark[]): boolean {
    return left.length === right.length
        && left.every((mark, index) =>
            mark.kind === right[index].kind
            && mark.unitStart === right[index].unitStart
            && mark.unitEnd === right[index].unitEnd
            && mark.term === right[index].term);
}
