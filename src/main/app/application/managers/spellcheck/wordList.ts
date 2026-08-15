import { SPELLCHECK_MAX_EDIT_DISTANCE, SPELLCHECK_MAX_SUGGESTIONS } from "@shared/types/spellcheck";

/**
 * One language's words, and the two questions asked of them: is this spelled correctly, and what
 * did the author mean.
 *
 * The source is a pre-expanded word list - plain text, one word per line - so there is no affix
 * engine and no morphology here. That is what makes the whole feature dependency-free: checking is
 * a set lookup, and suggesting is an edit distance over a filtered candidate set.
 *
 * ## Why the index is shaped like this
 *
 * A hundred thousand words is small enough to hold and far too many to score one at a time. Every
 * suggestion call therefore narrows the field twice before any real work happens, and both filters
 * are *complete* - neither can drop a word that is actually within the distance:
 *
 * 1. **Length.** An edit changes a word's length by at most one, so a candidate more than
 *    {@link SPELLCHECK_MAX_EDIT_DISTANCE} characters longer or shorter cannot be reached. Words are
 *    stored in per-length buckets, so this filter costs nothing at all - it picks five buckets.
 * 2. **Character signature.** Each word carries a 32-bit mask with one bit per character class
 *    (`charCode % 32`, which separates every ASCII letter). If the query contains characters from
 *    *n* classes the candidate has none of, reaching it needs at least *n* edits - so
 *    `popcount(query & ~candidate) > max` prunes, and so does the same test the other way round.
 *    Two integer operations per candidate, no allocation, and the two directions cover opposite
 *    cases: the forward test carries long queries, the reverse one carries short ones (for `teh`,
 *    it demands a candidate whose characters are nearly all drawn from `t`, `e`, `h`).
 *
 * Only what survives both reaches the Damerau-Levenshtein loop, which is the expensive part.
 *
 * ## Case
 *
 * Lookups are case-insensitive: the list carries proper nouns capitalised (`London`), and an author
 * who types `london` in mid-sentence has made a capitalisation mistake rather than a spelling one,
 * which is not this feature's to mark. Suggestions come back carrying the query's own shape, so
 * `Recieve` is answered with `Receive` and not with `receive`.
 */
export class WordList {
    /** Every entry, lower-cased. The one structure {@link has} reads. */
    private readonly lookup: Set<string>;
    /** Entries as written, grouped by length, with a signature per entry at the same index. */
    private readonly buckets: Map<number, { words: string[]; signatures: Uint32Array }>;

    private constructor(lookup: Set<string>, buckets: Map<number, { words: string[]; signatures: Uint32Array }>) {
        this.lookup = lookup;
        this.buckets = buckets;
    }

    /**
     * Build from the decompressed file.
     *
     * Tolerant by design: blank lines, comment lines and stray carriage returns are ordinary in a
     * hand-maintained list, and one of them must not cost the whole language.
     */
    public static fromText(text: string): WordList {
        const lookup = new Set<string>();
        const byLength = new Map<number, string[]>();

        for (const rawLine of text.split("\n")) {
            const word = rawLine.trim();
            if (!word || word.startsWith("#")) {
                continue;
            }
            const lower = word.toLowerCase();
            if (lookup.has(lower)) {
                continue;
            }
            lookup.add(lower);
            const bucket = byLength.get(word.length);
            if (bucket) {
                bucket.push(word);
            } else {
                byLength.set(word.length, [word]);
            }
        }

        const buckets = new Map<number, { words: string[]; signatures: Uint32Array }>();
        for (const [length, words] of byLength) {
            const signatures = new Uint32Array(words.length);
            for (let index = 0; index < words.length; index++) {
                signatures[index] = signatureOf(words[index].toLowerCase());
            }
            buckets.set(length, { words, signatures });
        }

        return new WordList(lookup, buckets);
    }

    /** How many distinct words the language holds. */
    public get size(): number {
        return this.lookup.size;
    }

    public has(word: string): boolean {
        return this.lookup.has(word.toLowerCase());
    }

    /**
     * The nearest words, nearest first, at most `limit`.
     *
     * Ordered by distance, then by whether the first letter survived - an author who mistypes the
     * middle of a word recognises a replacement that starts the same way, and one that does not
     * reads as a different word - then by length agreement, then alphabetically so the answer is
     * stable between calls.
     */
    public suggest(word: string, limit: number = SPELLCHECK_MAX_SUGGESTIONS): string[] {
        const query = word.toLowerCase();
        if (!query || limit <= 0) {
            return [];
        }
        const max = SPELLCHECK_MAX_EDIT_DISTANCE;
        const querySignature = signatureOf(query);
        const found: Array<{ word: string; distance: number }> = [];

        for (let length = query.length - max; length <= query.length + max; length++) {
            const bucket = this.buckets.get(length);
            if (!bucket) {
                continue;
            }
            const { words, signatures } = bucket;
            for (let index = 0; index < words.length; index++) {
                const signature = signatures[index];
                // Classes the query has and the candidate lacks, then the reverse. Each one is an
                // edit that must happen, so either count passing `max` rules the candidate out.
                if (popcount(querySignature & ~signature) > max || popcount(signature & ~querySignature) > max) {
                    continue;
                }
                const candidate = words[index];
                const distance = boundedEditDistance(query, candidate.toLowerCase(), max);
                if (distance >= 0) {
                    found.push({ word: candidate, distance });
                }
            }
        }

        const firstCharacter = query.charAt(0);
        found.sort((left, right) => {
            if (left.distance !== right.distance) {
                return left.distance - right.distance;
            }
            const leftKeepsInitial = left.word.charAt(0).toLowerCase() === firstCharacter ? 0 : 1;
            const rightKeepsInitial = right.word.charAt(0).toLowerCase() === firstCharacter ? 0 : 1;
            if (leftKeepsInitial !== rightKeepsInitial) {
                return leftKeepsInitial - rightKeepsInitial;
            }
            const leftLengthGap = Math.abs(left.word.length - query.length);
            const rightLengthGap = Math.abs(right.word.length - query.length);
            if (leftLengthGap !== rightLengthGap) {
                return leftLengthGap - rightLengthGap;
            }
            return left.word < right.word ? -1 : left.word > right.word ? 1 : 0;
        });

        return found.slice(0, limit).map(entry => matchCase(word, entry.word));
    }
}

/**
 * A 32-bit mask of the character classes a word contains.
 *
 * `charCode % 32` rather than a hash, because it is exact where it matters: `a`-`z` are codes
 * 97-122, which map onto 1-26 without a collision. Characters outside that range may share a bit,
 * which only makes the filter weaker - never wrong, since a shared bit can only fail to prune.
 */
function signatureOf(lowerWord: string): number {
    let signature = 0;
    for (let index = 0; index < lowerWord.length; index++) {
        signature |= 1 << (lowerWord.charCodeAt(index) % 32);
    }
    return signature;
}

/** Set bits in a 32-bit word, by the usual SWAR fold. */
function popcount(value: number): number {
    let bits = value - ((value >> 1) & 0x55555555);
    bits = (bits & 0x33333333) + ((bits >> 2) & 0x33333333);
    bits = (bits + (bits >> 4)) & 0x0f0f0f0f;
    return (bits * 0x01010101) >> 24;
}

/**
 * Rows reused across calls.
 *
 * {@link boundedEditDistance} runs tens of thousands of times per suggestion call, and three fresh
 * arrays per run is the difference between a suggestion that is free and one the garbage collector
 * pays for. Sized to the longest word worth checking and grown only if something longer arrives.
 */
let scratch = [new Uint8Array(64), new Uint8Array(64), new Uint8Array(64)];

/**
 * Damerau-Levenshtein distance, or `-1` once it is certainly past `max`.
 *
 * The optimal string alignment variant: a substring may take part in at most one transposition.
 * That is the standard reading of "one typo" for spellchecking - `hte` -> `the` is one edit - and
 * the unrestricted version differs only on inputs no author produces by accident.
 *
 * Bounded twice over. The length gap is checked before any work, and each row is abandoned as soon
 * as everything in it exceeds `max`, because a row's minimum can never fall again.
 */
export function boundedEditDistance(a: string, b: string, max: number): number {
    const lengthA = a.length;
    const lengthB = b.length;
    if (Math.abs(lengthA - lengthB) > max) {
        return -1;
    }
    if (a === b) {
        return 0;
    }

    const width = lengthB + 1;
    if (scratch[0].length < width) {
        scratch = [new Uint8Array(width * 2), new Uint8Array(width * 2), new Uint8Array(width * 2)];
    }
    let twoRowsBack = scratch[0];
    let previous = scratch[1];
    let current = scratch[2];

    // A distance is only ever compared against `max`, so anything past it can be pinned rather than
    // counted - which is what keeps the rows in a Uint8Array.
    const ceiling = max + 1;
    for (let column = 0; column <= lengthB; column++) {
        previous[column] = column > ceiling ? ceiling : column;
    }

    for (let row = 1; row <= lengthA; row++) {
        current[0] = row > ceiling ? ceiling : row;
        let rowMinimum = current[0];
        const characterA = a.charCodeAt(row - 1);

        for (let column = 1; column <= lengthB; column++) {
            const cost = characterA === b.charCodeAt(column - 1) ? 0 : 1;
            let value = Math.min(
                previous[column] + 1,
                current[column - 1] + 1,
                previous[column - 1] + cost,
            );
            if (
                row > 1
                && column > 1
                && characterA === b.charCodeAt(column - 2)
                && a.charCodeAt(row - 2) === b.charCodeAt(column - 1)
            ) {
                value = Math.min(value, twoRowsBack[column - 2] + 1);
            }
            if (value > ceiling) {
                value = ceiling;
            }
            current[column] = value;
            if (value < rowMinimum) {
                rowMinimum = value;
            }
        }

        if (rowMinimum > max) {
            return -1;
        }

        const spent = twoRowsBack;
        twoRowsBack = previous;
        previous = current;
        current = spent;
    }

    const distance = previous[lengthB];
    return distance > max ? -1 : distance;
}

/**
 * Give `suggestion` the shape of what the author typed.
 *
 * Only the two shapes that carry meaning: a capitalised word (a sentence opening, or a name) and an
 * all-capitals word (emphasis, or a shout). Anything else is returned as the list stores it, which
 * is how a proper noun keeps its capital when it is suggested for a lower-case typo.
 */
function matchCase(typed: string, suggestion: string): string {
    if (typed.length > 1 && typed === typed.toUpperCase() && typed !== typed.toLowerCase()) {
        return suggestion.toUpperCase();
    }
    const initial = typed.charAt(0);
    if (initial && initial === initial.toUpperCase() && initial !== initial.toLowerCase()) {
        return suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
    }
    return suggestion;
}
