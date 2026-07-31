import type { StoryTextSegment } from "@shared/types/story";

/**
 * How wide a line *looks*, which is not how long it is.
 *
 * A dialogue box is a fixed pixel width, and the thing that overflows it is rendered columns, not
 * `String.length`: 60 Chinese characters fill the same box 120 Latin ones do, and `"你好".length`
 * (2) is already the wrong answer before surrogate pairs are involved. So the default mode charges
 * East-Asian Wide/Fullwidth code points two columns and everything else one - the same rule
 * terminals have used since `wcwidth`, and the closest cheap approximation of a proportional font
 * that does not require measuring text in a DOM a lint rule has no business touching.
 *
 * Three decisions worth knowing:
 *
 *  - **Iteration is by code point, never by UTF-16 unit.** `for...of` over a string yields whole
 *    code points, so an astral character (emoji, CJK Extension B) counts once rather than twice for
 *    its surrogate pair. Counting `.length` would make every emoji look like two characters wide.
 *  - **Emoji are one column here.** They are not in any East-Asian width block, and their rendered
 *    advance depends entirely on the font the game ships. Guessing two would make the count wrong in
 *    the common case (a decorative emoji in a Latin line) to be right in a rare one.
 *  - **Interpolations contribute nothing** - see {@link segmentLiteralText}.
 */

export type LintTextCountMode = "eastAsianWidth" | "codePoints";

export const LINT_TEXT_COUNT_MODES: readonly LintTextCountMode[] = ["eastAsianWidth", "codePoints"];

/**
 * Code-point ranges rendered double width.
 *
 * The classic `wcwidth` set: Hangul Jamo initials, the CJK/Yi span, Hangul syllables, CJK
 * compatibility ideographs, vertical/fullwidth forms, and the astral CJK extensions. U+303F is the
 * one hole in the CJK span - it is the ideographic *half* fill space, one column by definition.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
    [0x1100, 0x115f],
    [0x2e80, 0x303e],
    [0x3040, 0xa4cf],
    [0xac00, 0xd7a3],
    [0xf900, 0xfaff],
    [0xfe30, 0xfe6f],
    [0xff00, 0xff60],
    [0xffe0, 0xffe6],
    [0x20000, 0x2fffd],
    [0x30000, 0x3fffd],
];

export function isEastAsianWide(codePoint: number): boolean {
    for (const [start, end] of WIDE_RANGES) {
        if (codePoint < start) {
            return false;
        }
        if (codePoint <= end) {
            return true;
        }
    }
    return false;
}

/** Rendered columns of a plain string under the given mode. */
export function measureTextWidth(text: string, mode: LintTextCountMode): number {
    let width = 0;
    for (const character of text) {
        if (mode === "codePoints") {
            width += 1;
            continue;
        }
        width += isEastAsianWide(character.codePointAt(0) ?? 0) ? 2 : 1;
    }
    return width;
}

/**
 * The literal text a segment renders, and only that.
 *
 * Interpolations are deliberately dropped rather than measured: `{playerName}` renders whatever the
 * save file holds, so its width is unknowable at lint time. Counting the placeholder text would
 * measure the *source*, which is a number about the script rather than about the screen, and would
 * fire on lines that are fine at runtime. Pauses and inline events project to no glyphs at all.
 *
 * This is why the width count is NOT `serializeSegmentSourceText()` - that one inserts `{n}` for
 * translators, which is exactly the fictional width this must not charge for.
 */
export function segmentLiteralText(segment: StoryTextSegment): string {
    if (!segment.rich || segment.rich.length === 0) {
        return segment.value;
    }
    let out = "";
    for (const run of segment.rich) {
        if ("text" in run) {
            out += run.text;
        }
    }
    return out;
}

export function measureSegmentWidth(segment: StoryTextSegment, mode: LintTextCountMode): number {
    return measureTextWidth(segmentLiteralText(segment), mode);
}
