/**
 * NarraLang lexical layer: the keyword set, the escaping rules, and the value spellings every
 * statement shares.
 *
 * Design doc: `docs/plans/2026-08-15-001-plan-narralang.md`.
 *
 * Two invariants this file exists to hold:
 *
 *  1. **Nothing here reads a locale.** No `translate`, no `localized*` table. A scene exported from a
 *     Chinese UI must be byte-identical to the same scene exported from an English one, or two
 *     collaborators reviewing the same commit see different files. This is the one rule the `.txt`
 *     codec got for free (it never called the projection at all) and that NarraLang has to keep on
 *     purpose.
 *  2. **Escaping is applied by the printer, never left to the author's judgement.** A prose line that
 *     would otherwise read as a statement is escaped on the way out, so the "first token is a
 *     keyword" rule can stay simple without ever misreading real prose.
 */

import type { StoryLiteralValue } from "@shared/types/story";
import { formatStorySecondsValue } from "@shared/utils/storyTime";

/** Two spaces per level. Indentation is the only nesting mechanism NarraLang has. */
export const NARRALANG_INDENT = "  ";

/** Opens a note row. Escaped at the head of prose. */
export const NARRALANG_NOTE_PREFIX = "#";

/**
 * Marks a disabled row - one the compiler skips, with its whole subtree, while it keeps its payload.
 *
 * A prefix rather than a modifier because it applies to every row kind including prose, and because
 * "this line does not run" is the first thing a reader needs to know about the line, not the last.
 */
export const NARRALANG_DISABLED_PREFIX = "~";

/** Addresses a built-in stage singleton (scene background, the two built-in layers). */
export const NARRALANG_BUILTIN_SIGIL = "@";

/**
 * Every word that may open a statement.
 *
 * Closed and lowercase, which is what keeps the prose rule cheap: a line is a statement only when its
 * first token is in here, so narration is the default and needs no marker of its own. Adding a
 * keyword makes previously-legal prose ambiguous, so the printer's escape (below) has to be able to
 * see the same set - which is why this is one table and not a switch spread over the printer.
 */
export const NARRALANG_KEYWORDS: ReadonlySet<string> = new Set([
    // prose-adjacent structure
    "menu",
    "if",
    "elif",
    "else",
    // scene & flow
    "bg",
    "jump",
    "wait",
    "nvl",
    "label",
    "goto",
    "break",
    "cut",
    "repeat",
    "parallel",
    "race",
    "sequence",
    // characters
    "show",
    "hide",
    "move",
    "face",
    "rename",
    "motion",
    "skin",
    "param",
    // audio
    "play",
    "stop",
    "pause",
    "resume",
    "mute",
    "unmute",
    "volume",
    "rate",
    "seek",
    // data
    "set",
    "var",
    // stage objects
    "image",
    "text",
    "layer",
    "video",
    "vfx",
    "transform",
    "mask",
    "clearmask",
    "clip",
    "clearclip",
    "filter",
    "clearfilter",
    "backdrop",
    "blend",
    "darken",
    "reveal",
    "close",
    "wipe",
    // camera & screen
    "camera",
    "blink",
    "vignette",
]);

/**
 * Where a piece of author text is being printed. The three contexts escape different things, and
 * getting one wrong is silent: an unescaped `:` in narration re-reads as a speaker, an unescaped `:`
 * at the end of a choice option eats the option's own block marker.
 */
export type NarralangProseContext =
    /** A narration row, or the text half of a dialogue row's line. */
    | "narration"
    /** The text after `Name: ` - the leading `: ` has already done its job, keywords cannot open. */
    | "dialogueText"
    /** A choice option, which always ends in the `:` that opens its body. */
    | "option"
    /** A note row, printed after `#`. */
    | "note";

/**
 * Escape author text for a given line context.
 *
 * Order matters: the backslash itself goes first, or every escape added afterwards gets doubled.
 */
export function escapeNarralangProse(text: string, context: NarralangProseContext): string {
    let out = text.replace(/\\/g, "\\\\");

    // Brace tags are the rich-text vocabulary, so a literal brace has to say so.
    out = out.replace(/\{/g, "\\{").replace(/\}/g, "\\}");

    // `: ` splits speaker from text. Every occurrence is escaped, not just the first: the parser
    // splits at the first UNescaped one, so leaving later colons bare would let a line with two of
    // them split in the wrong place.
    if (context === "narration" || context === "option" || context === "note") {
        out = out.replace(/: /g, "\\: ");
    }

    if (context === "narration") {
        // A line that would otherwise open a statement, a note, or a disabled row.
        const firstToken = out.split(" ", 1)[0] ?? "";
        if (
            NARRALANG_KEYWORDS.has(firstToken)
            || out.startsWith(NARRALANG_NOTE_PREFIX)
            || out.startsWith(NARRALANG_DISABLED_PREFIX)
        ) {
            out = `\\${out}`;
        }
    }

    if (context === "option") {
        // The option's own line ends in `:`; text that already does would swallow it.
        out = out.replace(/:$/, "\\:");
    }

    return out;
}

/**
 * Protect the whitespace at the two ends of a finished line.
 *
 * Applied to the assembled line, NOT per rich-text run: a run is a fragment, and its trailing space
 * is ordinary text sitting in the middle of the sentence. Escaping per run turned `Yes, ` followed by
 * an italic run into `Yes,\ {i}…`, and a run that was a single space into `\\ ` - the backslash
 * escape had already run, so the space escape doubled it. Only the line's own first and last
 * character can be lost to indentation or to an editor trimming the line.
 */
export function protectNarralangLineEdges(line: string): string {
    return line.replace(/^ /, "\\ ").replace(/ $/, "\\ ");
}

/**
 * A name as it appears in a statement slot: bare when it is a single plain token, single-quoted
 * otherwise.
 *
 * Single quotes are the entity-reference form the command line and the expression language already
 * use for spaced names, so an author who has typed `/jump 'Chapter 2'` reads `jump 'Chapter 2'`
 * without learning anything. Double quotes stay string literals.
 */
export function narralangName(name: string): string {
    if (name === "") {
        return "''";
    }
    const plain = /^[^\s'"{}:\\#]+$/.test(name) && !/^[0-9-]/.test(name) && !NARRALANG_KEYWORDS.has(name);
    if (plain) {
        return name;
    }
    return `'${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** A string literal slot (`text create title "第一章"`). Always quoted, so it is never a name. */
export function narralangString(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
export function narralangLiteral(value: StoryLiteralValue): string {
    if (typeof value === "number") {
        return narralangNumber(value);
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (value === null || value === undefined) {
        return "null";
    }
    return narralangString(String(value));
}

/**
 * Join a verb with its arguments, dropping the empty ones.
 *
 * Every statement is built through here so that "a modifier that resolved to nothing leaves no
 * trailing space" is true once rather than per call site - trailing whitespace is invisible in a
 * diff and would make two exports of the same scene differ.
 */
export function narralangStatement(...parts: readonly (string | undefined | null | false)[]): string {
    return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(" ");
}
