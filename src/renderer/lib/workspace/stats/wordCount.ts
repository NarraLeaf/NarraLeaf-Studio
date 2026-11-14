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

// Unified and compatibility ideographs, Hiragana, Katakana, and Hangul syllables.
const CJK_PATTERN =
    /[\p{Unified_Ideograph}\u3040-\u30ff\uf900-\ufaff\uac00-\ud7af\u{2f800}-\u{2fa1f}]/gu;

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
