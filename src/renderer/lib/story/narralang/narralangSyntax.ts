/**
 * NarraLang's lexical primitives: escaping, quoting, and the spellings a value carries in any slot.
 *
 * Design doc: `docs/plans/2026-08-15-001-plan-narralang.md`.
 *
 * Everything here takes the dialect rather than reading a constant, which is the whole point of the
 * split: a project that fences rich text with `[i]` needs `[` escaped in prose, and a project that
 * renames a verb needs prose starting with the new word escaped and prose starting with the old one
 * left alone. Both fall out of the table instead of being a second edit somewhere.
 *
 * Two invariants this file exists to hold:
 *
 *  1. **Nothing here reads a locale.** No `translate`, no `localized*` table. A scene exported from a
 *     Chinese UI must be byte-identical to the same scene exported from an English one, or two
 *     collaborators reviewing the same commit see different files.
 *  2. **Escaping is applied by the printer, never left to the author's judgement.** A prose line that
 *     would otherwise read as a statement is escaped on the way out, so the "first token is a
 *     keyword" rule can stay simple without ever misreading real prose.
 */

import type { StoryLiteralValue } from "@shared/types/story";
import { formatStorySecondsValue } from "@shared/utils/storyTime";

import { narralangDialectKeywords, type NarralangDialect } from "./narralangDialect";
import type { NarralangProseContext } from "./narralangShape";

/** Backslash-escape a literal string for use inside a regular-expression character class. */
function classEscape(text: string): string {
    return text.replace(/[^a-zA-Z0-9]/g, (char) => `\\${char}`);
}

const BARE_NAME_CACHE = new WeakMap<NarralangDialect, RegExp>();

/**
 * The characters that stop a name from standing bare.
 *
 * Derived from the dialect rather than listed, because "bare" means exactly "reads back as one
 * token": a name holding the dialect's own quote, fence, separator, escape or note marker would be
 * cut in the wrong place, and which characters those are is precisely what a dialect changes.
 */
function bareNamePattern(dialect: NarralangDialect): RegExp {
    const cached = BARE_NAME_CACHE.get(dialect);
    if (cached) {
        return cached;
    }
    const reserved = [
        ...dialect.quote.name,
        ...dialect.quote.string,
        dialect.text.open,
        dialect.text.close,
        dialect.speakerSeparator,
        dialect.escape,
        dialect.prefix.note,
    ].join("");
    const pattern = new RegExp(`^[^\\s${classEscape([...new Set(reserved)].join(""))}]+$`);
    BARE_NAME_CACHE.set(dialect, pattern);
    return pattern;
}

/** Replace every occurrence of a plain string. */
function replaceAll(text: string, find: string, replacement: string): string {
    return find === "" ? text : text.split(find).join(replacement);
}

/**
 * Escape author text for a given line context.
 *
 * Order matters: the escape character itself goes first, or every escape added afterwards gets
 * doubled.
 */
export function escapeNarralangProse(
    text: string,
    context: NarralangProseContext,
    dialect: NarralangDialect,
): string {
    const mark = dialect.escape;
    let out = replaceAll(text, mark, `${mark}${mark}`);

    // The tag fences are the rich-text vocabulary, so a literal one has to say so.
    out = replaceAll(out, dialect.text.open, `${mark}${dialect.text.open}`);
    if (dialect.text.close !== dialect.text.open) {
        out = replaceAll(out, dialect.text.close, `${mark}${dialect.text.close}`);
    }

    // The speaker separator splits a name from the line they say. Every occurrence is escaped, not
    // just the first: the parser splits at the first UNescaped one, so leaving later ones bare would
    // let a line with two of them split in the wrong place.
    const separator = `${dialect.speakerSeparator} `;
    if (context === "narration" || context === "option" || context === "note") {
        out = replaceAll(out, separator, `${mark}${separator}`);
    }

    // The pass above matches the separator FOLLOWED BY A SPACE, so a line that merely ends in one
    // slips through - and `他说:` then reads back as a speaker with nothing to say. Narration only:
    // an option ending in the separator is handled by the block-marker rule at the foot of this
    // function (they are the same character in the default dialect, and escaping twice would leave a
    // stray mark), and a note is already claimed by its own prefix.
    if (context === "narration" && out.endsWith(dialect.speakerSeparator)) {
        out = `${out.slice(0, -dialect.speakerSeparator.length)}${mark}${dialect.speakerSeparator}`;
    }

    // An option's text is a line of its own, so it can be misread exactly as narration can - and the
    // rule was missing here, which made an option beginning with a keyword print unescaped and read
    // back as that statement. A note needs none of this: its own prefix already says what the line is.
    if (context === "narration" || context === "option") {
        // A line that would otherwise open a statement, a note, or a disabled row.
        const firstToken = out.split(" ", 1)[0] ?? "";
        if (
            narralangDialectKeywords(dialect).has(firstToken)
            || out.startsWith(dialect.prefix.note)
            || out.startsWith(dialect.prefix.disabled)
        ) {
            out = `${mark}${out}`;
        }
    }

    // The option's own line ends in the block marker; text that already does would swallow it. Skipped
    // when the marker is a tag fence, which the pass above has already escaped everywhere.
    const blockOpen = dialect.block.open;
    if (
        context === "option"
        && blockOpen !== ""
        && blockOpen !== dialect.text.open
        && blockOpen !== dialect.text.close
        && out.endsWith(blockOpen)
    ) {
        out = `${out.slice(0, -blockOpen.length)}${mark}${blockOpen}`;
    }

    return out;
}

/**
 * Protect the whitespace at the two ends of a finished line.
 *
 * Applied to the assembled line, NOT per rich-text run: a run is a fragment, and its trailing space
 * is ordinary text sitting in the middle of the sentence. Escaping per run turned `Yes, ` followed by
 * an italic run into `Yes,\ {i}…`, and a run that was a single space into `\\ ` - the escape pass had
 * already run, so the space escape doubled it. Only the line's own first and last character can be
 * lost to indentation or to an editor trimming the line.
 */
export function protectNarralangLineEdges(line: string, dialect: NarralangDialect): string {
    return line.replace(/^ /, `${dialect.escape} `).replace(/ $/, `${dialect.escape} `);
}

/**
 * A name as it appears in a statement slot: bare when it is a single plain token, quoted otherwise.
 *
 * The default dialect's single quotes are the entity-reference form the command line and the
 * expression language already use for spaced names, so an author who has typed `/jump 'Chapter 2'`
 * reads `jump 'Chapter 2'` without learning anything. Double quotes stay string literals.
 */
export function narralangName(name: string, dialect: NarralangDialect): string {
    const [open, close] = dialect.quote.name;
    if (name === "") {
        return `${open}${close}`;
    }
    const plain = bareNamePattern(dialect).test(name)
        && !/^[0-9-]/.test(name)
        && !narralangDialectKeywords(dialect).has(name);
    if (plain) {
        return name;
    }
    return `${open}${quoted(name, close, dialect)}${close}`;
}

/** A string literal slot (`text create title "第一章"`). Always quoted, so it is never a name. */
export function narralangString(value: string, dialect: NarralangDialect): string {
    const [open, close] = dialect.quote.string;
    return `${open}${quoted(value, close, dialect)}${close}`;
}

/**
 * A rich-text tag's argument: bare when it is a single plain token, quoted otherwise.
 *
 * The same rule {@link narralangName} follows, and for the same reason - a tag's parts are separated
 * by spaces, so an argument holding one tears the tag open. `{color rgb(56, 189, 248)}` is a real
 * stored value and it was being printed verbatim, which produced a tag nothing could read back.
 *
 * Quoted only when it has to be, rather than always: `{color #ff8080}` and `{ruby かのじょ}` are what
 * an author reads all day, and one rule ("quote it when it would not survive being read back") is
 * what they already know from names.
 */
export function narralangTagArgument(value: string, dialect: NarralangDialect): string {
    const [open] = dialect.quote.string;
    const plain = value !== ""
        && !/\s/.test(value)
        && !value.startsWith(open)
        && !value.includes(dialect.escape)
        && !value.includes(dialect.text.open)
        && !value.includes(dialect.text.close);
    return plain ? value : narralangString(value, dialect);
}

function quoted(value: string, close: string, dialect: NarralangDialect): string {
    const mark = dialect.escape;
    return replaceAll(replaceAll(value, mark, `${mark}${mark}`), close, `${mark}${close}`);
}

/**
 * Seconds, printed the way the command line prints them - `formatStorySecondsValue` is the shared
 * spelling, so `500` reads as `0.5` here exactly as it does in a row.
 */
export function narralangSeconds(ms: number | undefined | null): string {
    return formatStorySecondsValue(ms);
}

/** A bare number, trimmed of the float noise a stored value can carry. */
export function narralangNumber(value: number): string {
    if (!Number.isFinite(value)) {
        return "0";
    }
    return String(Number(value.toFixed(6)));
}

/** A literal in a slot that accepts any of the four literal types. */
export function narralangLiteral(value: StoryLiteralValue, dialect: NarralangDialect): string {
    if (typeof value === "number") {
        return narralangNumber(value);
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (value === null || value === undefined) {
        return "null";
    }
    // An array or an object - what a `json` variable holds. `String(value)` turned these into
    // `[object Object]`, which is not a value, not reversible, and not even readable; the command
    // line already spells a json default as quoted JSON (`/local inv "[1, 2]" type=json`), so this
    // is the spelling an author has already met.
    if (typeof value === "object") {
        return narralangString(JSON.stringify(value), dialect);
    }
    return narralangString(String(value), dialect);
}
