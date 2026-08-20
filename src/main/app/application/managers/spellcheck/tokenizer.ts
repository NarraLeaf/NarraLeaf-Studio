/**
 * Finding the words in a run of plain text.
 *
 * The checker never sees a document, only a string, so this is the whole of its idea of structure.
 * Offsets are indices into that string; the caller that built it is the only thing that can map
 * them back onto whatever they came from.
 *
 * Two scripts, two ways of finding a word. In a language that puts spaces between words, a word is
 * whatever the spaces leave behind and the vocabulary is consulted afterwards. In Chinese and
 * Japanese there are no spaces, so word-finding *is* segmentation: the vocabulary has to be
 * consulted to know where one word ends, which is why {@link extractWords} takes a lexicon.
 */

/** One candidate word and where it sat. */
export type TextWord = {
    start: number;
    end: number;
    word: string;
};

/**
 * What segmenting a script without spaces needs of a language's vocabulary.
 *
 * Deliberately narrower than the word list itself, so the caller can widen it: the manager passes a
 * lexicon that answers for the project's own dictionary as well, and a character name the author
 * has taught the project is then a word the segmenter can cut on rather than a run it reports.
 */
export type SegmentationLexicon = {
    has(word: string): boolean;
    /** Longest entry, in UTF-16 units. An over-estimate is safe; it only costs lookups. */
    maxWordLength?: number;
};

/**
 * A run of letters, with apostrophes and hyphens allowed inside it.
 *
 * Both are kept rather than split on, because both belong to the word in the languages this checks:
 * `don't` and `mother-in-law` are entries a word list carries, and splitting them would mark `t`
 * and `in` as words in their own right. Digits and underscores are matched so that a token
 * containing them is *seen* and then rejected whole - matching only letters would find `abc` inside
 * `abc123` and mark it.
 *
 * Han characters and kana are letters too, so a Chinese sentence between two full stops arrives
 * here as one token. Splitting that token is what {@link segmentedWords} is for.
 */
/**
 * Characters that are words on their own, and so end a run rather than joining it.
 *
 * Chinese writes its pronouns, particles, conjunctions and commonest adverbs as single
 * characters, and they sit between words constantly. Counting them would make every ordinary
 * sentence look like a stretch of characters that would not join up, which is the one thing this
 * rule must not do. The list is deliberately closed and small: it holds the classes that are
 * grammar rather than vocabulary, so it does not grow with the word list and cannot be tuned into
 * hiding real findings.
 *
 * Japanese needs no equivalent. It writes those same roles in kana, and kana never enter a run.
 */
const STANDS_ALONE = new Set([
    // pronouns and demonstratives
    "我", "你", "您", "他", "她", "它", "这", "那", "谁", "其", "此",
    // structural and aspect particles
    "的", "了", "着", "过", "地", "得", "之", "所", "吗", "呢", "吧", "啊",
    // copula, common verbs and prepositions that stand between phrases
    "是", "在", "有", "说", "做", "去", "来", "给", "把", "被", "让", "向", "到", "从", "对", "跟", "与", "为",
    // commonest adverbs and conjunctions
    "很", "不", "没", "也", "都", "就", "才", "又", "再", "还", "已", "更", "最", "太", "和", "或", "但", "而", "则", "却", "将", "能", "会", "要", "该", "得",
    // numerals and measure words that stand alone between nouns
    "一", "两", "几", "每", "个", "些", "张", "条", "件", "只", "部", "场", "次", "回",
]);

const TOKEN = /[\p{L}\p{M}\p{Nd}_'’-]+/gu;

/** A word must contain a letter, and must contain nothing that rules it out as prose. */
const HAS_LETTER = /\p{L}/u;
const NOT_A_WORD = /[\p{Nd}_]/u;

/**
 * Spans no spellchecker should touch: addresses, mail addresses, and file paths.
 *
 * A script that quotes a URL is quoting a string, not writing prose, and marking half of it as
 * misspellings is noise the author cannot act on - the correction would break the address.
 */
const OPAQUE = /(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/|www\.)\S+|\S+@\S+\.\S+/g;

/** Trimmed from the ends of a token: they join words in the middle and punctuate them at the edge. */
const EDGE = /^[-'’]+|[-'’]+$/g;

/**
 * A character belonging to a script that writes without spaces.
 *
 * Script extensions rather than plain script, so the marks that only ever appear inside a Japanese
 * word travel with it: the prolonged sound mark of `コーヒー` is script Common and would otherwise
 * cut the word in half. Punctuation shares those extensions too, but punctuation never reaches here
 * - {@link TOKEN} has already dropped it.
 */
const SEGMENTED_SCRIPT = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}]/u;

/** Han proper. Kana are excluded, which is the whole of the Japanese script rule below. */
const HAN = /\p{Script=Han}/u;

/** Iteration marks: they repeat the character before them rather than spelling anything. */
const ITERATION = /[々〻]/u;

/**
 * How far a segment may reach, in characters.
 *
 * Chinese words and Japanese compounds run to four or five characters, set idioms to four, and the
 * longest thing an author is likely to teach the project is a full name. Past sixteen a match would
 * be a phrase rather than an entry. The bound is a cost bound only: a longer reach can find more
 * words and therefore report fewer runs, never more.
 */
const MAX_SEGMENT_CHARACTERS = 16;

/** Whether `text` holds a character from a script that writes without spaces. */
export function containsSegmentedScript(text: string): boolean {
    return SEGMENTED_SCRIPT.test(text);
}

/**
 * Every word in `text`, in order, with its offsets.
 *
 * What is deliberately not returned from a spaced script: anything shorter than two characters (a
 * lone letter is a label, an initial or a variable, never a spelling), anything holding a digit or
 * an underscore (identifiers, version numbers, filenames), and anything inside a URL, mail address
 * or path.
 *
 * `lexicon` is only read for Chinese and Japanese, and without one those scripts yield nothing at
 * all: a run whose word boundaries are unknown holds no word that can be judged, and answering with
 * the whole run would mark a paragraph as a single misspelling.
 */
export function extractWords(text: string, lexicon?: SegmentationLexicon | null): TextWord[] {
    const opaque = opaqueSpans(text);
    const words: TextWord[] = [];
    let opaqueIndex = 0;

    TOKEN.lastIndex = 0;
    for (let match = TOKEN.exec(text); match !== null; match = TOKEN.exec(text)) {
        const raw = match[0];
        const rawStart = match.index;

        // Both lists run left to right, so the cursor only ever moves forward.
        while (opaqueIndex < opaque.length && opaque[opaqueIndex].end <= rawStart) {
            opaqueIndex += 1;
        }
        if (opaqueIndex < opaque.length && opaque[opaqueIndex].start < rawStart + raw.length) {
            continue;
        }

        if (!SEGMENTED_SCRIPT.test(raw)) {
            pushSpacedWord(words, raw, rawStart);
            continue;
        }
        // A mixed token - a Latin name inside a Japanese line - is two problems side by side, and
        // each half is answered by the rule for its own script.
        for (const span of scriptSpans(raw)) {
            if (span.segmented) {
                pushSegmentedWords(words, text, rawStart + span.start, rawStart + span.end, lexicon);
            } else {
                pushSpacedWord(words, raw.slice(span.start, span.end), rawStart + span.start);
            }
        }
    }

    return words;
}

/** One token cut where it changes between a script that spaces its words and one that does not. */
function scriptSpans(raw: string): Array<{ start: number; end: number; segmented: boolean }> {
    const spans: Array<{ start: number; end: number; segmented: boolean }> = [];
    let index = 0;
    let spanStart = 0;
    let spanSegmented = false;
    let started = false;

    for (const character of raw) {
        const segmented = SEGMENTED_SCRIPT.test(character);
        if (!started) {
            started = true;
            spanSegmented = segmented;
        } else if (segmented !== spanSegmented) {
            spans.push({ start: spanStart, end: index, segmented: spanSegmented });
            spanStart = index;
            spanSegmented = segmented;
        }
        index += character.length;
    }
    if (started) {
        spans.push({ start: spanStart, end: index, segmented: spanSegmented });
    }
    return spans;
}

/** One word from a script that separates them, trimmed and judged as prose. */
function pushSpacedWord(words: TextWord[], raw: string, rawStart: number): void {
    const leading = raw.length - raw.replace(/^[-'’]+/, "").length;
    const word = raw.replace(EDGE, "");
    if (word.length < 2 || !HAS_LETTER.test(word) || NOT_A_WORD.test(word)) {
        return;
    }
    const start = rawStart + leading;
    words.push({ start, end: start + word.length, word });
}

/**
 * Whether a character can be wrong on its own.
 *
 * Only Han. A kana left over by the segmentation below is inflection, a particle, or the tail of a
 * word the lexicon holds in its stem form, and none of those is a spelling the vocabulary can rule
 * on. Iteration marks are excluded for the same reason a repeated character cannot be the wrong
 * one: they carry whatever stands before them.
 */
function canStandWrong(character: string): boolean {
    return HAN.test(character) && !ITERATION.test(character);
}

/**
 * The words in one run of Chinese or Japanese, and the runs that are not words.
 *
 * ## The cut
 *
 * A dynamic program rather than greedy longest-match, over segments that are either a lexicon entry
 * or a single character standing alone. It minimises the number of Han characters left standing
 * alone, and settles ties towards fewer segments, which is longest-match wherever longest-match is
 * right. The reason not to take longest-match on its own: it commits to the longest word at each
 * step and can strand a character that a different cut would have covered, and a stranded character
 * is reported. Every one of those is a false positive on correct writing, and the program does not
 * have that failure - it finds a full cover whenever one exists.
 *
 * ## Japanese script mixing
 *
 * Kana cost nothing when they stand alone, so the program is free to leave them uncovered, and only
 * a Han character it could not cover is ever reported. Okurigana follows from that without a rule
 * of its own: `食べます` is covered whether the lexicon holds `食べる`, `食べ` or bare `食`, because
 * covering the kanji is what the program is paid for and the trailing kana are free either way. A
 * kana-only stretch therefore yields no findings at all, which is the intended answer for
 * inflection, particles, and the katakana of a name.
 *
 * ## What is reported
 *
 * Consecutive uncovered Han characters are joined into one finding rather than reported one by one.
 * An unknown name is uncovered along its whole length, and the author's answer to it is to teach the
 * project the name - which only works if what the checker marked is the name and not its first
 * character.
 */
function pushSegmentedWords(
    words: TextWord[],
    text: string,
    spanStart: number,
    spanEnd: number,
    lexicon: SegmentationLexicon | null | undefined,
): void {
    if (!lexicon || spanEnd <= spanStart) {
        return;
    }

    // Where every character begins, plus the end of the last, so a segment is one slice of the
    // original text and the offsets handed back index that text rather than a copy of it.
    const offsets: number[] = [];
    for (let index = spanStart; index < spanEnd;) {
        offsets.push(index);
        index += (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
    }
    offsets.push(spanEnd);
    const count = offsets.length - 1;

    const declared = lexicon.maxWordLength ?? MAX_SEGMENT_CHARACTERS;
    const reach = Math.min(Math.max(declared, 1), MAX_SEGMENT_CHARACTERS);

    // cost: Han characters left standing alone in the first n characters, at its lowest.
    // pieces: how many segments that took, which is how ties settle.
    // from/known: the backward pointers the segmentation is read off.
    const cost = new Array<number>(count + 1).fill(0);
    const pieces = new Array<number>(count + 1).fill(0);
    const from = new Array<number>(count + 1).fill(0);
    const known = new Array<boolean>(count + 1).fill(false);

    for (let end = 1; end <= count; end++) {
        // The last character standing alone. Always available, so every run has an answer.
        let bestCost = cost[end - 1] + (canStandWrong(text.slice(offsets[end - 1], offsets[end])) ? 1 : 0);
        let bestPieces = pieces[end - 1] + 1;
        let bestFrom = end - 1;
        let bestKnown = false;

        for (let begin = Math.max(0, end - reach); begin < end; begin++) {
            if (!lexicon.has(text.slice(offsets[begin], offsets[end]))) {
                continue;
            }
            const candidateCost = cost[begin];
            const candidatePieces = pieces[begin] + 1;
            if (candidateCost < bestCost || (candidateCost === bestCost && candidatePieces < bestPieces)) {
                bestCost = candidateCost;
                bestPieces = candidatePieces;
                bestFrom = begin;
                bestKnown = true;
            }
        }

        cost[end] = bestCost;
        pieces[end] = bestPieces;
        from[end] = bestFrom;
        known[end] = bestKnown;
    }

    const segments: Array<{ begin: number; end: number; known: boolean }> = [];
    for (let end = count; end > 0; end = from[end]) {
        segments.push({ begin: from[end], end, known: known[end] });
    }
    segments.reverse();

    let pendingBegin = -1;
    let pendingEnd = -1;
    let pendingKnown = false;
    const flush = () => {
        if (pendingBegin < 0) {
            return;
        }
        const start = offsets[pendingBegin];
        const stop = offsets[pendingEnd];
        // Two or more characters the cut could not join into a word, standing next to each
        // other, are reported as one stretch. A lone character is not: a list carries thousands
        // of single characters and the ones it lacks are rare forms, so marking one of those is
        // noise. What is left is the shape a mistyped or invented word makes - a place the
        // language would normally have joined characters up and here did not.
        if (pendingEnd - pendingBegin >= 2) {
            words.push({ start, end: stop, word: text.slice(start, stop) });
        } else if (pendingKnown) {
            // A single character that is an entry stays a word of its own, so it is not judged.
            words.push({ start, end: stop, word: text.slice(start, stop) });
        }
        pendingBegin = -1;
        pendingEnd = -1;
        pendingKnown = false;
    };

    for (const segment of segments) {
        const isSingle = segment.end - segment.begin === 1;
        const glyph = text.slice(offsets[segment.begin], offsets[segment.end]);
        // A known single character joins the run rather than ending it, unless it is one of the
        // words that legitimately stand alone between others. Without that exclusion an ordinary
        // line reads as a run at every pronoun and particle; with it, what remains is characters
        // that had nothing to attach to.
        if (segment.known && isSingle && !STANDS_ALONE.has(glyph)) {
            if (pendingBegin < 0) {
                pendingBegin = segment.begin;
                pendingKnown = true;
            }
            pendingEnd = segment.end;
            continue;
        }
        if (segment.known) {
            flush();
            const start = offsets[segment.begin];
            const stop = offsets[segment.end];
            words.push({ start, end: stop, word: text.slice(start, stop) });
            continue;
        }
        if (!canStandWrong(text.slice(offsets[segment.begin], offsets[segment.end]))) {
            flush();
            continue;
        }
        if (pendingBegin < 0) {
            pendingBegin = segment.begin;
        }
        pendingEnd = segment.end;
    }
    flush();
}

function opaqueSpans(text: string): Array<{ start: number; end: number }> {
    const spans: Array<{ start: number; end: number }> = [];
    OPAQUE.lastIndex = 0;
    for (let match = OPAQUE.exec(text); match !== null; match = OPAQUE.exec(text)) {
        spans.push({ start: match.index, end: match.index + match[0].length });
    }
    return spans;
}
