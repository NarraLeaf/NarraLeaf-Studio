import {
    type ProjectDictionaryEntry,
    type ProjectDictionaryOptions,
} from "../types/dictionary";

/**
 * Reading one line of script against the project dictionary.
 *
 * Two questions, answered in one pass because they are asked about the same characters and the
 * answers may not overlap:
 *
 *  - **variant** - the line writes a spelling this project has recorded as another way of writing a
 *    term it does own. The term is offered as the replacement.
 *  - **reading** - the line writes a term the project has recorded a reading for, and this
 *    occurrence carries no ruby. The reading is offered.
 *
 * Deliberately not a lint rule and deliberately not a check over the whole project. It is a reader
 * over one string, so the story editor can run it on the row being typed without asking anything
 * outside the row, and so the mapping - which is where this kind of feature gets things wrong - is
 * testable without a laid-out browser.
 *
 * Comments in English per project convention.
 */

export type DictionaryMatchKind = "variant" | "reading";

/** One thing the dictionary has to say about a stretch of the line. */
export type DictionaryMatch = {
    kind: DictionaryMatchKind;
    /** Offset of the first character in the searched string. */
    start: number;
    /** Offset one past the last character. */
    end: number;
    /** The text as the line writes it. */
    text: string;
    /** The term the entry is keyed by. */
    term: string;
    /**
     * What to write instead. Only on a `variant`, and it is the term with the written
     * capitalisation carried over, so replacing a variant at the start of a sentence does not
     * lower-case it.
     */
    replacement?: string;
    /** The reading to apply. Only on a `reading`. */
    reading?: string;
};

/**
 * Whether a character can be part of a word for the purpose of finding one.
 *
 * Only true of scripts that write their words apart. A term found inside a longer Latin word is a
 * coincidence - `colour` inside `colourless` - and marking it would be wrong; a term found inside a
 * longer run of kanji is ordinary, because that is how the script is written, and demanding a
 * boundary there would find nothing at all.
 */
const WORDISH = /[\p{L}\p{N}_]/u;
const SEGMENTED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function isWordish(character: string | undefined): boolean {
    return character !== undefined && WORDISH.test(character) && !SEGMENTED.test(character);
}

/** Whether `[start, end)` in `text` stands as a word rather than inside a longer one. */
export function standsAlone(text: string, start: number, end: number): boolean {
    if (isWordish(text[start]) && isWordish(text[start - 1])) {
        return false;
    }
    if (isWordish(text[end - 1]) && isWordish(text[end])) {
        return false;
    }
    return true;
}

/**
 * The term, written the way the line wrote what it is replacing.
 *
 * Only the first character, and only from lower to upper. A variant matched at the start of a
 * sentence is the case this exists for; anything more elaborate - all caps, title case over a
 * two-word term - is guessing at a style the author has not stated.
 */
export function carryCapitalisation(term: string, written: string): string {
    const first = written[0];
    if (!first || first !== first.toUpperCase() || first === first.toLowerCase()) {
        return term;
    }
    const head = term[0];
    if (!head || head === head.toUpperCase()) {
        return term;
    }
    return head.toUpperCase() + term.slice(1);
}

/**
 * One thing to look for. Built once per dictionary by {@link dictionaryNeedles} and reused for every
 * line, because a scene is hundreds of rows and the list does not change between them.
 */
export type DictionaryNeedle = {
    kind: DictionaryMatchKind;
    /** What to look for, already folded when the search ignores case. */
    search: string;
    term: string;
    reading?: string;
    /** Whether `search` was folded, and so whether it is looked for in the folded text. */
    folded: boolean;
};

/** What the dictionary is looking for in a line. */
export function dictionaryNeedles(
    entries: readonly ProjectDictionaryEntry[],
    options: ProjectDictionaryOptions,
): DictionaryNeedle[] {
    const terms = new Set(entries.map(entry => entry.term.toLowerCase()));
    const needles: DictionaryNeedle[] = [];
    for (const entry of entries) {
        if (options.checkVariants) {
            for (const variant of entry.variants ?? []) {
                // A variant that is also some entry's own term is not a variant here. It can only
                // come from a dictionary that records the same spelling twice - a hand-edited file,
                // or a merge that kept both sides - and marking a word the project owns as the wrong
                // way to write another one is the worse of the two readings.
                if (terms.has(variant.toLowerCase())) {
                    continue;
                }
                needles.push({kind: "variant", search: variant.toLowerCase(), term: entry.term, folded: true});
            }
        }
        if (options.suggestReadings && entry.reading) {
            // Exactly as written, not folded: a reading belongs to a spelling, and the scripts that
            // take ruby have no case to ignore.
            needles.push({kind: "reading", search: entry.term, term: entry.term, reading: entry.reading, folded: false});
        }
    }
    return needles;
}

/**
 * Everything the dictionary has to say about `text`, in order, with nothing overlapping anything
 * else.
 *
 * `isAnnotated` is asked about a reading before it is offered, and answers whether that stretch of
 * the line already carries a ruby of its own. It is a callback rather than a flag because the answer
 * lives in the editor's run model, which this module deliberately cannot see.
 *
 * A variant beats a reading over the same characters. The line is written the wrong way there, and
 * offering to annotate a spelling the project is about to replace would be work the author has to
 * undo.
 */
export function findDictionaryMatches(
    text: string,
    entries: readonly ProjectDictionaryEntry[],
    options: ProjectDictionaryOptions,
    isAnnotated?: (start: number, end: number) => boolean,
): DictionaryMatch[] {
    return matchDictionaryNeedles(text, dictionaryNeedles(entries, options), isAnnotated);
}

/**
 * The same, against needles already built.
 *
 * What the story editor calls, once per edited row. Rebuilding the needles per keystroke would put
 * the whole dictionary through a loop for a line that has not changed shape.
 */
export function matchDictionaryNeedles(
    text: string,
    needles: readonly DictionaryNeedle[],
    isAnnotated?: (start: number, end: number) => boolean,
): DictionaryMatch[] {
    if (!text || needles.length === 0) {
        return [];
    }
    const folded = text.toLowerCase();
    const found: DictionaryMatch[] = [];

    for (const needle of needles) {
        if (!needle.search) {
            continue;
        }
        const haystack = needle.folded ? folded : text;
        // The folded text can differ in length from the original for a handful of characters (ﬁ, İ),
        // which would put every offset after them somewhere else entirely. Rare enough to be worth
        // skipping the line rather than complicating every offset below.
        if (needle.folded && folded.length !== text.length) {
            continue;
        }
        let from = 0;
        for (;;) {
            const start = haystack.indexOf(needle.search, from);
            if (start < 0) {
                break;
            }
            const end = start + needle.search.length;
            from = start + 1;
            if (!standsAlone(text, start, end)) {
                continue;
            }
            const written = text.slice(start, end);
            if (needle.kind === "reading") {
                if (isAnnotated?.(start, end)) {
                    continue;
                }
                found.push({kind: "reading", start, end, text: written, term: needle.term, reading: needle.reading});
                continue;
            }
            found.push({
                kind: "variant",
                start,
                end,
                text: written,
                term: needle.term,
                replacement: carryCapitalisation(needle.term, written),
            });
        }
    }

    found.sort((left, right) => {
        if (left.start !== right.start) {
            return left.start - right.start;
        }
        if (left.kind !== right.kind) {
            return left.kind === "variant" ? -1 : 1;
        }
        // The longer reading of the same opening characters. A dictionary holding both a name and
        // the full name it starts should mark the full one.
        return right.end - left.end;
    });

    const kept: DictionaryMatch[] = [];
    let consumed = 0;
    for (const match of found) {
        if (match.start < consumed) {
            continue;
        }
        kept.push(match);
        consumed = match.end;
    }
    return kept;
}
