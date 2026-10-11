/**
 * Inline styling in a `.story` line: `{b}…{/b}`, `{i}…{/i}` and `{color=#e04040}…{/color}`.
 *
 * A dialogue, narration or option segment may carry `rich` runs - text with marks the story editor
 * sets (bold, italic, colour, and more). This module spells the three marks above as tags inside
 * the line and reads them back into runs. Tags nest (`{color=#f00}{b}red bold{/b}{/color}`); a close
 * tag closes the innermost open tag of its own kind.
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
 * A `{` that starts one of the tag shapes above is written `\{` when it is meant literally; any other
 * brace is ordinary text. Everything else follows the line's usual escapes (`shapes.ts`), because the
 * spelled line goes through `escapeText` whole: tags are swapped for private-use stand-ins first, so
 * the line-level rules (a leading marker, a leading or trailing space, `: `) apply to the line as it
 * reads rather than to each run.
 *
 * Comments in English per project convention.
 */

import type { StoryRichRun, StoryTextMarks, StoryTextSegment } from "@shared/types/story";
import { escapeText } from "./shapes";

/** The marks this format spells. */
type SpelledMark = "color" | "bold" | "italic";

const TAG_NAME: Record<SpelledMark, string> = { color: "color", bold: "b", italic: "i" };

/**
 * A tag at the start of `text`, or null. Colour values are anything up to the closing brace that is
 * not empty and holds no brace or line break - a hex code, a CSS colour name, `rgb(…)`.
 */
const TAG_PATTERN = /^\{(?:(\/?)(b|i)|(\/)color|color=([^{}\n\r]+?))\}/;

export function startsInlineTag(text: string): boolean {
    return TAG_PATTERN.test(text);
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
    return tag.mark === "color" ? `{color=${tag.value}}` : `{${TAG_NAME[tag.mark]}}`;
}

function closeText(tag: OpenTag): string {
    return `{/${TAG_NAME[tag.mark]}}`;
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
        if (text[index] === "{" && startsInlineTag(text.slice(index))) {
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
        if (char === "{") {
            const match = TAG_PATTERN.exec(escaped.slice(index));
            if (match) {
                flush();
                sawTag = true;
                const [whole, slash, shortName, colorClose, colorValue] = match;
                if (colorValue !== undefined) {
                    open.push({ mark: "color", value: colorValue.trim() });
                } else if (shortName) {
                    const mark: SpelledMark = shortName === "b" ? "bold" : "italic";
                    if (slash) {
                        const at = findLast(open, tag => tag.mark === mark);
                        if (at < 0) {
                            return { ok: false, detail: `"{/${shortName}}" closes a {${shortName}} that is not open` };
                        }
                        open.splice(at, 1);
                    } else {
                        open.push({ mark });
                    }
                } else if (colorClose) {
                    const at = findLast(open, tag => tag.mark === "color");
                    if (at < 0) {
                        return { ok: false, detail: "\"{/color}\" closes a {color=…} that is not open" };
                    }
                    open.splice(at, 1);
                }
                index += whole.length - 1;
                continue;
            }
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
