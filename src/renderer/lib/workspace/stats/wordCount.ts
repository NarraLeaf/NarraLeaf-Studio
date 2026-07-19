/**
 * Word counting for mixed CJK / Latin script.
 *
 * "Words" means different things per script and there is no single correct answer, so this picks
 * the convention authors actually use to measure their own output: each CJK ideograph or kana is
 * one unit, and each run of Latin/Cyrillic/digits is one unit. A Chinese novelist counting 字 and
 * an English novelist counting words both get the number they expect from the same function.
 *
 * Punctuation is excluded from both sides.
 */

// Han, Hiragana, Katakana, Hangul, and the CJK compatibility/extension blocks in common use.
const CJK_PATTERN =
    /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]|[\ud840-\ud868\ud86a-\ud86c\ud86f-\ud872][\udc00-\udfff]/gu;

// A run of letters/digits, allowing internal apostrophes and hyphens ("don't", "well-known").
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

export function countWords(text: string): number {
    if (!text) {
        return 0;
    }

    const cjkMatches = text.match(CJK_PATTERN);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;

    // Strip the CJK before matching Latin runs; otherwise a "中文abc" token would be counted by
    // both patterns, since \p{L} matches ideographs too.
    const withoutCjk = text.replace(CJK_PATTERN, " ");
    const wordMatches = withoutCjk.match(WORD_PATTERN);
    const wordCount = wordMatches ? wordMatches.length : 0;

    return cjkCount + wordCount;
}
