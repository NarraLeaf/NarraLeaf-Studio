/**
 * Inline styling in a `.story` line: `{b}…{/b}`, `{i}…{/i}` and `{color #e04040}…{/color}`.
 *
 * A dialogue, narration or option segment may carry `rich` runs - text with marks the story editor
 * sets (bold, italic, colour, and more). This module spells the three marks above as tags inside
 * the line and reads them back into runs. Tags nest (`{color #f00}{b}red bold{/b}{/color}`); a close
 * tag closes the innermost open tag of its own kind.
 *
 * ## One spelling with the Script View
 *
 * The tags are the Script View's (`narralangDialect.ts`, `NARRALANG_DEFAULT_DIALECT.text`): the
 * fences, the close sigil and each mark's word come off that table, and a colour is its argument
 * after a space, quoted the way the Script View quotes one (`narralangTagArgument`) when it holds a
 * space - `{color "rgb(56, 189, 248)"}`. So one rich-run model has one spelling in both text surfaces.
 * `{color=#e04040}` is still read - it is what this format printed first, what agents and the public
 * skill docs were taught, and what Ren'Py writes - but never printed.
 *
 * The nesting is this format's own: colour outermost and tags kept open across runs that share them,
 * so a coloured phrase with a bold word in it is one colour tag, where the Script View wraps every
 * run on its own. Each reads the other's order.
 *
 * What is NOT shared is the reader and printer themselves, because the two formats escape
 * differently. The Script View escapes every fence character in prose (`\{`, `\}`) and reads a
 * backslash as "the next character, literally"; a `.story` line escapes only a brace that would start
 * one of the tags below (`{gold}` stays text, as `{name}` placeholders in a line need it to) and
 * decodes `\n`, `\r` and `\t` as the rest of the line does (`shapes.ts`). Reading a `.story` line
 * with the Script View's reader would turn every placeholder into an unknown tag and every escaped
 * line break into the letter `n`.
 *
 * ## What is spelled, and what stays a `»` row
 *
 * Only a segment whose every run is plain text marked with nothing but bold, italic and colour is
 * spelled. A segment with anything else - ruby, size, typing speed, emphasis dots, an inline pause,
 * an interpolated variable, an inline event - returns null from {@link spellRichSegment}, and the
 * printer keeps the row as an opaque `»` line, exactly as it kept every styled row before this
 * existed. The printer also echo-checks every line it writes (see `print.ts`), so a run layout this
 * reader would rebuild differently (two adjacent runs with the same marks, an empty run) falls back
 * the same way rather than being silently merged.
 *
 * ## Escaping
 *
 * A `{` that starts one of the tag shapes above (the `{color=…}` alias included) is written `\{` when
 * it is meant literally; any other brace is ordinary text. Everything else follows the line's usual
 * escapes (`shapes.ts`), because the spelled line goes through `escapeText` whole: tags are swapped
 * for private-use stand-ins first, so the line-level rules (a leading marker, a leading or trailing
 * space, `: `) apply to the line as it reads rather than to each run - and a quoted colour keeps the
 * Script View's own `\"` and `\\` inside its quotes.
 *
 * Comments in English per project convention.
 */

import type { StoryRichRun, StoryTextMarks, StoryTextSegment } from "@shared/types/story";
import { NARRALANG_DEFAULT_DIALECT } from "@/lib/story/narralang/narralangDialect";
import { decodeNarralangEscapes } from "@/lib/story/narralang/narralangLex";
import { narralangTagArgument } from "@/lib/story/narralang/narralangSyntax";
import { escapeText } from "./shapes";

/** The marks this format spells. */
type SpelledMark = "color" | "bold" | "italic";

const SPELLED_MARKS: readonly SpelledMark[] = ["bold", "italic", "color"];

/** The Script View's rich-text table, which this format spells its tags from. */
const DIALECT = NARRALANG_DEFAULT_DIALECT;
const TEXT = DIALECT.text;

/** Each spelled mark's tag word, and whether it takes an argument - read off the dialect's table. */
const TAG_WORD: Record<SpelledMark, { word: string; argument: boolean }> = (() => {
    const words = {} as Record<SpelledMark, { word: string; argument: boolean }>;
    for (const mark of SPELLED_MARKS) {
        const spec = TEXT.marks.find(entry => entry.mark === mark);
        if (!spec) {
            throw new Error(`The Script View dialect has no tag for "${mark}".`);
        }
        words[mark] = { word: spec.tag, argument: spec.arg !== undefined };
    }
    return words;
})();

/** The spelling this format read first, `{color=#e04040}`: still read, never printed. */
const ALIAS_SEPARATOR = "=";

type TagMatch = {
    /** How many characters of the source the tag spans. */
    length: number;
    mark: SpelledMark;
    close: boolean;
    /** A colour's value, decoded. Empty when the tag names none, which the reader refuses. */
    value?: string;
};

/**
 * A tag at `at` in `text`, or null. The shapes are `{b}`, `{/b}`, `{i}`, `{/i}`, `{/color}`,
 * `{color VALUE}` - a bare token, or a string quoted the Script View's way - and the alias
 * `{color=VALUE}`, whose value is anything up to the closing brace without a brace or line break.
 * A colour tag that names no colour (`{color=}`, `{color ""}`) still matches, so a literal one is
 * escaped and a typed one is refused by name rather than read as a run with no colour.
 */
function matchTag(text: string, at = 0): TagMatch | null {
    if (!text.startsWith(TEXT.open, at)) {
        return null;
    }
    let index = at + TEXT.open.length;
    const close = TEXT.closeSigil !== "" && text.startsWith(TEXT.closeSigil, index);
    if (close) {
        index += TEXT.closeSigil.length;
    }
    for (const mark of SPELLED_MARKS) {
        const { word, argument } = TAG_WORD[mark];
        if (!text.startsWith(word, index)) {
            continue;
        }
        const after = index + word.length;
        if (close || !argument) {
            if (text.startsWith(TEXT.close, after)) {
                return { length: after + TEXT.close.length - at, mark, close };
            }
            continue;
        }
        const read = readArgument(text, after);
        if (read) {
            return { length: read.end - at, mark, close: false, value: read.value };
        }
    }
    return null;
}

/** A colour tag's value from just after its word up to and including the closing fence, or null. */
function readArgument(text: string, from: number): { value: string; end: number } | null {
    if (text.startsWith(ALIAS_SEPARATOR, from)) {
        const match = /^([^{}\n\r]*)\}/.exec(text.slice(from + ALIAS_SEPARATOR.length));
        return match && TEXT.close === "}"
            ? { value: match[1].trim(), end: from + ALIAS_SEPARATOR.length + match[0].length }
            : null;
    }
    if (text[from] !== " ") {
        return null;
    }
    let index = from;
    while (text[index] === " ") {
        index += 1;
    }
    const [quoteOpen, quoteClose] = DIALECT.quote.string;
    let value: string;
    if (quoteOpen !== "" && text.startsWith(quoteOpen, index)) {
        let scan = index + quoteOpen.length;
        while (scan < text.length && !text.startsWith(quoteClose, scan)) {
            if (text[scan] === "\n" || text[scan] === "\r") {
                return null;
            }
            scan += text.startsWith(DIALECT.escape, scan) ? DIALECT.escape.length + 1 : 1;
        }
        if (scan >= text.length) {
            return null;
        }
        value = decodeNarralangEscapes(text.slice(index + quoteOpen.length, scan), DIALECT);
        index = scan + quoteClose.length;
    } else {
        // A bare token, as `narralangTagArgument` prints one: no space, fence or escape, and not
        // opening with a quote.
        const match = /^[^\s{}\\"][^\s{}\\]*/.exec(text.slice(index));
        if (!match) {
            return null;
        }
        value = match[0];
        index += match[0].length;
    }
    while (text[index] === " ") {
        index += 1;
    }
    return text.startsWith(TEXT.close, index) ? { value, end: index + TEXT.close.length } : null;
}

export function startsInlineTag(text: string): boolean {
    return matchTag(text) !== null;
}

type OpenTag = { mark: SpelledMark; value?: string };

/** A run's marks as the stack of tags that draws them: colour outermost, then bold, then italic. */
function tagsFor(marks: StoryTextMarks | undefined): OpenTag[] {
    const tags: OpenTag[] = [];
    if (marks?.color) {
        tags.push({ mark: "color", value: marks.color });
    }
    if (marks?.bold) {
        tags.push({ mark: "bold" });
    }
    if (marks?.italic) {
        tags.push({ mark: "italic" });
    }
    return tags;
}

function sameTag(a: OpenTag, b: OpenTag): boolean {
    return a.mark === b.mark && a.value === b.value;
}

function openText(tag: OpenTag): string {
    const { word, argument } = TAG_WORD[tag.mark];
    const body = argument ? `${word} ${narralangTagArgument(tag.value ?? "", DIALECT)}` : word;
    return `${TEXT.open}${body}${TEXT.close}`;
}

function closeText(tag: OpenTag): string {
    return `${TEXT.open}${TEXT.closeSigil}${TAG_WORD[tag.mark].word}${TEXT.close}`;
}

/** True when a run's marks are all ones this format spells (and it is a text run). */
function isSpellableRun(run: StoryRichRun): run is { text: string; marks?: StoryTextMarks } {
    if (!("text" in run) || typeof run.text !== "string") {
        return false;
    }
    const marks = run.marks;
    if (!marks) {
        return true;
    }
    for (const [key, value] of Object.entries(marks)) {
        if (value === undefined) {
            continue;
        }
        if (key === "bold" || key === "italic") {
            if (value !== true) {
                return false;
            }
            continue;
        }
        if (key === "color") {
            if (typeof value !== "string" || !value.trim() || /[{}\n\r]/.test(value) || value !== value.trim()) {
                return false;
            }
            continue;
        }
        return false;
    }
    return true;
}

// Private-use stand-ins while the line is escaped as a whole: U+E000.. for the tags, U+F8FF for a
// literal brace that needs its backslash. Code points the author's text cannot usefully contain; a
// segment that does contain one is not spelled (and a plain one is escaped the old way).
const STAND_IN_BASE = 0xe000;
const PRIVATE_USE = /[-]/;
const TAG_STAND_INS = /[-]/g;
const LITERAL_BRACE = "";

/**
 * A rich segment as one escaped line body (the words after any `Speaker: `), or null when its runs
 * use anything this format does not spell. A segment without `rich` is not this module's business:
 * the caller escapes its plain `value` as it always has.
 */
export function spellRichSegment(segment: StoryTextSegment): string | null {
    const runs = segment.rich;
    if (!runs || runs.length === 0 || !runs.every(isSpellableRun)) {
        return null;
    }
    const tags: string[] = [];
    const standIn = (tag: string) => {
        tags.push(tag);
        return String.fromCharCode(STAND_IN_BASE + tags.length - 1);
    };
    let body = "";
    let open: OpenTag[] = [];
    for (const run of runs as { text: string; marks?: StoryTextMarks }[]) {
        if (PRIVATE_USE.test(run.text)) {
            return null;
        }
        const wanted = tagsFor(run.marks);
        // Keep the longest prefix of what is open that this run also wants; close the rest, then
        // open what is missing. Text between tags is untouched here and escaped below.
        let keep = 0;
        while (keep < open.length && keep < wanted.length && sameTag(open[keep], wanted[keep])) {
            keep += 1;
        }
        for (let index = open.length - 1; index >= keep; index -= 1) {
            body += standIn(closeText(open[index]));
        }
        for (let index = keep; index < wanted.length; index += 1) {
            body += standIn(openText(wanted[index]));
        }
        open = wanted;
        body += escapeLiteralTags(run.text);
    }
    for (let index = open.length - 1; index >= 0; index -= 1) {
        body += standIn(closeText(open[index]));
    }
    if (tags.length > 0x1000) {
        return null;
    }
    const escaped = escapeText(body, { asProse: true });
    return escaped
        .replace(TAG_STAND_INS, char => tags[char.charCodeAt(0) - STAND_IN_BASE])
        .split(LITERAL_BRACE).join("\\{");
}

/**
 * Mark every literal `{` that would read back as a tag with the {@link LITERAL_BRACE} stand-in. It is
 * swapped for `\{` only after `escapeText`, which would otherwise double the backslash.
 */
function escapeLiteralTags(text: string): string {
    let out = "";
    for (let index = 0; index < text.length; index += 1) {
        if (matchTag(text, index)) {
            out += LITERAL_BRACE;
            continue;
        }
        out += text[index];
    }
    return out;
}

/** Escape a plain segment value: the line's usual escapes plus `\{` before a literal tag shape. */
export function escapePlainWithTags(value: string): string {
    if (!value.includes("{") || PRIVATE_USE.test(value)) {
        return escapeText(value, { asProse: true });
    }
    return escapeText(escapeLiteralTags(value), { asProse: true }).split(LITERAL_BRACE).join("\\{");
}

export type InlineMarkupResult =
    | { ok: true; value: string; rich?: StoryRichRun[] }
    | { ok: false; detail: string };

/**
 * Read an escaped line body (still escaped - a `\{` must stay literal) into its plain value and, when
 * it holds tags, its runs. Escapes are decoded here exactly as `unescapeText` decodes them.
 */
export function readInlineMarkup(escaped: string): InlineMarkupResult {
    const runs: { text: string; marks?: StoryTextMarks }[] = [];
    const open: OpenTag[] = [];
    let sawTag = false;
    let text = "";
    const marksNow = (): StoryTextMarks | undefined => {
        const marks: StoryTextMarks = {};
        for (const tag of open) {
            if (tag.mark === "color") {
                marks.color = tag.value;
            } else if (tag.mark === "bold") {
                marks.bold = true;
            } else {
                marks.italic = true;
            }
        }
        return Object.keys(marks).length > 0 ? marks : undefined;
    };
    const flush = () => {
        if (!text) {
            return;
        }
        const marks = marksNow();
        runs.push(marks ? { text, marks } : { text });
        text = "";
    };
    for (let index = 0; index < escaped.length; index += 1) {
        const char = escaped[index];
        if (char === "\\") {
            const next = escaped[index + 1];
            if (next === undefined) {
                text += "\\";
                continue;
            }
            index += 1;
            text += next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next;
            continue;
        }
        const match = matchTag(escaped, index);
        if (match) {
            flush();
            sawTag = true;
            const source = escaped.slice(index, index + match.length);
            if (match.close) {
                const at = findLast(open, tag => tag.mark === match.mark);
                if (at < 0) {
                    const word = TAG_WORD[match.mark].word;
                    const opener = TAG_WORD[match.mark].argument ? `{${word} …}` : `{${word}}`;
                    return { ok: false, detail: `"${source}" closes a ${opener} that is not open` };
                }
                open.splice(at, 1);
            } else if (TAG_WORD[match.mark].argument) {
                if (!match.value) {
                    return { ok: false, detail: `"${source}" names no colour: write {color #e04040}, or "\\{" for a literal brace` };
                }
                open.push({ mark: match.mark, value: match.value });
            } else {
                open.push({ mark: match.mark });
            }
            index += match.length - 1;
            continue;
        }
        text += char;
    }
    flush();
    if (open.length > 0) {
        return { ok: false, detail: `${open.map(openText).join(", ")} ${open.length === 1 ? "is" : "are"} never closed` };
    }
    const value = runs.map(run => run.text).join("");
    if (!sawTag || runs.every(run => !run.marks)) {
        return { ok: true, value };
    }
    return { ok: true, value, rich: runs };
}

function findLast<T>(items: readonly T[], test: (item: T) => boolean): number {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        if (test(items[index])) {
            return index;
        }
    }
    return -1;
}
