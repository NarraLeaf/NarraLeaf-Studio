/**
 * Shared scanning primitives for the style tooling (ratchet + codemod).
 *
 * Both tools must agree on two questions, or the ratchet ends up policing text
 * that ships no CSS at all:
 *
 *   - which files count      → shipped renderer sources, not tests
 *   - which bytes count      → code, not comments
 *
 * The second one is not pedantry. The design-system components document the
 * hand-rolled patterns they replaced in their own JSDoc — e.g. Badge.tsx says
 * it replaces "`rounded px-1.5 py-0.5 text-2xs border …` chips" — so scanning
 * comment text charges the component library for the debt it retired, and the
 * only way to make the gate green would be to delete the documentation.
 * Comments are blanked (not removed) so byte offsets stay valid for callers
 * that rewrite files in place.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Patterns the design-system consolidation is retiring. See docs/design-system.md. */
export const METRICS = {
    "arbitrary-hex": /\[#[0-9a-fA-F]{3,8}\]/g,
    "raw-neutral-palette": /\b(?:bg|text|border|ring|divide|from|via|to)-(?:gray|slate|zinc|neutral|stone)-\d/g,
    "raw-white-black-alpha": /\b(?:bg|text|border|ring|divide|shadow|from|via|to)-(?:white|black)\/\d/g,
    "arbitrary-px-font": /text-\[\d+px\]/g,
    "bare-or-arbitrary-rounded": /\brounded(?![-\w])|rounded-\[/g,
    "raw-accent": /#40a8c4|\b(?:bg|text|border|ring)-cyan-\d/gi,
};

/**
 * Collect scannable sources under `dir`.
 *
 * Tests are excluded: a `.test.ts` file never reaches a stylesheet, and its
 * fixtures legitimately assert on literal values
 * (`expect(isReadableAccentColor("#40a8c4"))`) that would otherwise read as
 * debt no refactor can remove.
 */
export function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === "dist" || name === "node_modules" || name === "__tests__") continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(name) && !/\.(?:test|spec)\.tsx?$/.test(name)) out.push(full);
    }
    return out;
}

/** Index of the next unescaped `delim` at or after `from`, or -1. */
function closingQuote(src, from, delim, allowNewline) {
    for (let i = from; i < src.length; i++) {
        const c = src[i];
        if (c === "\\") { i++; continue; }
        if (c === delim) return i;
        if (!allowNewline && c === "\n") return -1;
    }
    return -1;
}

/**
 * End index of the string literal opening at `start`, or -1 if that quote is
 * not opening one.
 *
 * Three cases, and all three occur in this codebase:
 *
 *   - a template literal may span lines freely;
 *   - a JS string closes on its own line;
 *   - a *JSX attribute* string may also span lines — CheckboxField.tsx wraps a
 *     long `className="…"` across three — so a same-line-only rule silently
 *     skips those class lists. Multi-line is allowed only when the quote is
 *     preceded by `=`, which an apostrophe in JSX text (`<p>don't</p>`) never
 *     is; that one must stay ordinary text or it would swallow the file.
 */
function literalEnd(src, start) {
    const delim = src[start];
    if (delim === "`") return closingQuote(src, start + 1, delim, true);
    const sameLine = closingQuote(src, start + 1, delim, false);
    if (sameLine !== -1) return sameLine;
    return src[start - 1] === "=" ? closingQuote(src, start + 1, delim, true) : -1;
}

/** [start, end] index pairs of every string/template literal in `src`. */
export function literalRanges(src) {
    const ranges = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === "`" || c === '"' || c === "'") {
            const end = literalEnd(src, i);
            if (end !== -1) { ranges.push([i, end]); i = end + 1; continue; }
        }
        i++;
    }
    return ranges;
}

/**
 * Replace comment bodies with spaces, preserving length and newlines.
 *
 * Deliberately a scanner, not a parser, but the two ways a scanner gets this
 * wrong are both handled:
 *
 *   - `//` inside a string (`"https://…"`) is not a comment. Strings are
 *     tracked, and a bare `://` is skipped even outside one.
 *   - An apostrophe in JSX text (`<p>don't</p>`) is not a string opener. A
 *     `'`/`"` only opens a string if it closes on the same line, which is the
 *     actual rule for JS string literals; template literals may span lines.
 *
 * Errors in the remaining edge cases leave comments *un*blanked, which can only
 * hold a count too high — never hide real debt.
 */
export function blankComments(src) {
    const out = src.split("");
    const blank = (from, to) => {
        for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
    };

    let i = 0;
    while (i < src.length) {
        const c = src[i];

        if (c === "`" || c === '"' || c === "'") {
            const end = literalEnd(src, i);
            if (end !== -1) { i = end + 1; continue; }
            i++; // not a literal (e.g. an apostrophe in JSX text)
            continue;
        }

        if (c === "/" && src[i + 1] === "*") {
            const end = src.indexOf("*/", i + 2);
            const stop = end === -1 ? src.length : end + 2;
            blank(i, stop);
            i = stop;
            continue;
        }

        if (c === "/" && src[i + 1] === "/" && src[i - 1] !== ":") {
            let end = src.indexOf("\n", i);
            if (end === -1) end = src.length;
            blank(i, end);
            i = end;
            continue;
        }

        i++;
    }
    return out.join("");
}

/** Read a file and return { src, code } where `code` has comments blanked. */
export function readCode(file) {
    const src = readFileSync(file, "utf8");
    return { src, code: blankComments(src) };
}
