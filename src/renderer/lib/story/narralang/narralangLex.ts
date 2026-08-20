/**
 * The lexical half of the parser: a line of script becomes tokens, and a fenced run becomes text.
 *
 * Design doc: `docs/plans/2026-08-15-001-plan-narralang.md`.
 *
 * The inverse of {@link ./narralangSyntax} and {@link ./narralangText}, and dialect-driven for the
 * same reason they are: which characters open a quote, which one escapes, which pair fences a tag are
 * all things a project may change, so nothing here may name one. A token therefore remembers HOW it
 * was written (bare, name-quoted, string-quoted) rather than only what it says - the matcher needs
 * that to tell a name slot from a string slot, which is a distinction the printer spends quoting on.
 */

import type { StoryTextMarks } from "@shared/types/story";
import { storySecondsToMs } from "@shared/utils/storyTime";

import type { NarralangDialect } from "./narralangDialect";
import type { NarralangProseContext, NarralangText, NarralangTextRun } from "./narralangShape";

// --- Tokens ---------------------------------------------------------------------------------------

export type NarralangTokenQuote = "none" | "name" | "string";

export type NarralangToken = {
    /** The token as it reads: quotes stripped, escapes decoded. */
    readonly text: string;
    /**
     * Which fence the token was written inside.
     *
     * Load-bearing rather than cosmetic: `"blur(4px)"` is a string literal and `blur` is a name, and
     * the only thing that says so is the quote the printer chose.
     */
    readonly quote: NarralangTokenQuote;
    /** Offsets into the line body, so a slot taking raw source can slice it back out verbatim. */
    readonly start: number;
    readonly end: number;
    /** Set on a marker token split off a preceding one - the dialect's `attach` punctuation. */
    readonly attach?: string;
    /**
     * Whether the escape marker touched this token.
     *
     * The whole point of `\show me the money` is that its first word is NOT the keyword, so a token
     * that had to be decoded can never open a statement. Losing this is how an escaped prose line
     * becomes a broken command.
     */
    readonly escaped?: true;
};

const ATTACH_CACHE = new WeakMap<NarralangDialect, readonly string[]>();

/**
 * Every punctuation the dialect glues to the end of a token.
 *
 * Collected from the verb table rather than listed, so a dialect that attaches something new is
 * lexed by this file without it being taught the word.
 */
function dialectAttachStrings(dialect: NarralangDialect): readonly string[] {
    const cached = ATTACH_CACHE.get(dialect);
    if (cached) {
        return cached;
    }
    const found = new Set<string>();
    for (const syntax of Object.values(dialect.verbs)) {
        for (const slot of syntax.slots) {
            if (slot.attach !== undefined && slot.attach !== "") {
                found.add(slot.attach);
            }
        }
    }
    // Longest first, so `::` is recognised before `:` would eat half of it.
    const list = [...found].sort((a, b) => b.length - a.length);
    ATTACH_CACHE.set(dialect, list);
    return list;
}

/** Strip the escape marker from a run of author text. */
export function decodeNarralangEscapes(text: string, dialect: NarralangDialect): string {
    const mark = dialect.escape;
    if (mark === "") {
        return text;
    }
    let out = "";
    let index = 0;
    while (index < text.length) {
        if (text.startsWith(mark, index) && index + mark.length < text.length) {
            index += mark.length;
            out += text[index] ?? "";
            index += 1;
            continue;
        }
        out += text[index];
        index += 1;
    }
    return out;
}

/** Read a fenced token, honouring the escape inside it. Returns the body and the offset after it. */
function readQuoted(
    line: string,
    from: number,
    open: string,
    close: string,
    dialect: NarralangDialect,
): { text: string; end: number } {
    const mark = dialect.escape;
    let index = from + open.length;
    let out = "";
    while (index < line.length) {
        if (mark !== "" && line.startsWith(mark, index) && index + mark.length < line.length) {
            out += line[index + mark.length];
            index += mark.length + 1;
            continue;
        }
        if (line.startsWith(close, index)) {
            return { text: out, end: index + close.length };
        }
        out += line[index];
        index += 1;
    }
    // Unterminated: the rest of the line is the value. The matcher decides whether that is legal;
    // failing here would turn a typo into a thrown error rather than a diagnostic.
    return { text: out, end: line.length };
}

/**
 * One statement line as tokens.
 *
 * Whitespace separates, the two quote pairs group, and the escape protects any character from both
 * rules. An attached punctuation is split off into a marker token of its own, which is what lets the
 * matcher treat `attach` exactly like a `lead` instead of carrying a second rule for glued syntax.
 */
export function tokenizeNarralangLine(line: string, dialect: NarralangDialect): NarralangToken[] {
    const [nameOpen, nameClose] = dialect.quote.name;
    const [stringOpen, stringClose] = dialect.quote.string;
    const mark = dialect.escape;
    const tokens: NarralangToken[] = [];
    let index = 0;
    while (index < line.length) {
        const char = line[index];
        if (char === " " || char === "\t") {
            index += 1;
            continue;
        }
        const start = index;
        if (stringOpen !== "" && line.startsWith(stringOpen, index)) {
            const read = readQuoted(line, index, stringOpen, stringClose, dialect);
            tokens.push({ text: read.text, quote: "string", start, end: read.end });
            index = read.end;
            continue;
        }
        if (nameOpen !== "" && line.startsWith(nameOpen, index)) {
            const read = readQuoted(line, index, nameOpen, nameClose, dialect);
            tokens.push({ text: read.text, quote: "name", start, end: read.end });
            index = read.end;
            continue;
        }
        let raw = "";
        let escaped = false;
        while (index < line.length && line[index] !== " " && line[index] !== "\t") {
            if (mark !== "" && line.startsWith(mark, index) && index + mark.length < line.length) {
                raw += line.slice(index, index + mark.length + 1);
                index += mark.length + 1;
                escaped = true;
                continue;
            }
            raw += line[index];
            index += 1;
        }
        const text = decodeNarralangEscapes(raw, dialect);
        tokens.push(escaped
            ? { text, quote: "none", start, end: index, escaped: true }
            : { text, quote: "none", start, end: index });
    }
    return splitAttached(tokens, dialectAttachStrings(dialect));
}

/**
 * Split the dialect's glued punctuation into a marker of its own.
 *
 * Safe to do unconditionally because a bare token can never END in one of these on its own account:
 * the printer quotes any name holding the speaker separator, and the block marker has already been
 * taken off the line by the time this runs.
 */
function splitAttached(tokens: readonly NarralangToken[], attaches: readonly string[]): NarralangToken[] {
    if (attaches.length === 0) {
        return [...tokens];
    }
    const out: NarralangToken[] = [];
    for (const token of tokens) {
        const previous = out[out.length - 1];
        const attach = token.quote === "none"
            ? attaches.find((candidate) => token.text.length > candidate.length && token.text.endsWith(candidate))
            : undefined;
        // A quoted value keeps its punctuation outside the quotes (`'player name': string`), so the
        // marker arrives as a token of its own - and it is one only when it is GLUED to what it
        // follows. The gap is what separates it from a `:` an expression's ternary put there.
        if (attach === undefined && token.quote === "none" && previous !== undefined && token.start === previous.end) {
            const whole = attaches.find((candidate) => token.text === candidate);
            if (whole !== undefined) {
                out.push({ text: whole, quote: "none", start: token.start, end: token.end, attach: whole });
                continue;
            }
        }
        if (attach === undefined) {
            out.push(token);
            continue;
        }
        const head = token.text.slice(0, -attach.length);
        out.push(
            token.escaped
                ? { text: head, quote: "none", start: token.start, end: token.end - attach.length, escaped: true }
                : { text: head, quote: "none", start: token.start, end: token.end - attach.length },
        );
        out.push({ text: attach, quote: "none", start: token.end - attach.length, end: token.end, attach });
    }
    return out;
}

// --- Scalars --------------------------------------------------------------------------------------

/** A bare token that reads as a number, or `null`. Rejects the empty string, which `Number` calls 0. */
export function narralangTokenNumber(token: NarralangToken): number | null {
    if (token.quote !== "none" || token.text.trim() === "") {
        return null;
    }
    const value = Number(token.text);
    return Number.isFinite(value) ? value : null;
}

/** The millisecond value behind a seconds token. */
export function narralangTokenMs(token: NarralangToken): number | null {
    const seconds = narralangTokenNumber(token);
    return seconds === null ? null : storySecondsToMs(seconds);
}

/**
 * Whether a bare token reads as a CSS colour.
 *
 * Deliberately narrow: a hex triple, or a function call with no spaces in it. A named CSS colour
 * (`red`) is indistinguishable from an asset called `red`, and guessing would silently turn one into
 * the other - so the parser reads it as a name and reports the miss the lookups return.
 */
export function isNarralangColorToken(token: NarralangToken): boolean {
    if (token.quote !== "none") {
        return false;
    }
    return /^#[0-9a-fA-F]{3,8}$/.test(token.text) || /^[a-z]+\([^\s]*\)$/i.test(token.text);
}

// --- Rich text ------------------------------------------------------------------------------------

export type NarralangTextIssue = "unknownTag" | "unclosedTag";

/**
 * A line of author text as runs - the inverse of {@link printNarralangText}.
 *
 * Marks nest, so the reader keeps a stack and stamps whatever is open onto each run of plain text.
 * Two adjacent runs carrying the same marks are indistinguishable from one run once printed, so they
 * come back as one; nothing downstream can tell the difference, and the text they project is
 * identical.
 */
export function parseNarralangText(
    raw: string,
    context: NarralangProseContext,
    dialect: NarralangDialect,
    report: (issue: NarralangTextIssue, offset: number, detail?: string) => void,
): NarralangText {
    const runs: NarralangTextRun[] = [];
    const open: { mark: keyof StoryTextMarks; value: boolean | string | number }[] = [];
    const mark = dialect.escape;
    const { open: fenceOpen, close: fenceClose, closeSigil } = dialect.text;
    let pending = "";
    let index = 0;

    const marksNow = (): StoryTextMarks | undefined => {
        if (open.length === 0) {
            return undefined;
        }
        const marks: Record<string, boolean | string | number> = {};
        for (const entry of open) {
            marks[entry.mark] = entry.value;
        }
        return marks as StoryTextMarks;
    };
    const flush = (): void => {
        if (pending === "") {
            return;
        }
        const marks = marksNow();
        const previous = runs[runs.length - 1];
        // Two runs the printer would have fenced identically are one run here. See the doc comment.
        if (previous && "text" in previous && sameMarks(previous.marks, marks)) {
            runs[runs.length - 1] = marks === undefined
                ? { text: previous.text + pending }
                : { text: previous.text + pending, marks };
        } else {
            runs.push(marks === undefined ? { text: pending } : { text: pending, marks });
        }
        pending = "";
    };

    while (index < raw.length) {
        if (mark !== "" && raw.startsWith(mark, index) && index + mark.length < raw.length) {
            pending += raw[index + mark.length];
            index += mark.length + 1;
            continue;
        }
        if (fenceOpen !== "" && raw.startsWith(fenceOpen, index)) {
            const closeAt = findFenceClose(raw, index + fenceOpen.length, fenceClose, dialect);
            if (closeAt < 0) {
                report("unclosedTag", index);
                pending += raw.slice(index);
                break;
            }
            const body = raw.slice(index + fenceOpen.length, closeAt);
            flush();
            applyTag(body);
            index = closeAt + fenceClose.length;
            continue;
        }
        pending += raw[index];
        index += 1;
    }
    flush();
    if (open.length > 0) {
        report("unclosedTag", raw.length, open[open.length - 1].mark);
    }
    return { context, runs };

    function applyTag(body: string): void {
        if (closeSigil !== "" && body.startsWith(closeSigil)) {
            const tag = body.slice(closeSigil.length);
            const spec = dialect.text.marks.find((entry) => entry.tag === tag);
            if (!spec) {
                report("unknownTag", index, body);
                return;
            }
            for (let i = open.length - 1; i >= 0; i -= 1) {
                if (open[i].mark === spec.mark) {
                    open.splice(i, 1);
                    return;
                }
            }
            report("unknownTag", index, body);
            return;
        }
        const space = body.indexOf(" ");
        const head = space < 0 ? body : body.slice(0, space);
        const argument = space < 0 ? undefined : body.slice(space + 1);

        if (head === dialect.text.pause) {
            const seconds = argument === undefined ? undefined : Number(argument);
            runs.push({ pause: seconds === undefined || !Number.isFinite(seconds) ? true : storySecondsToMs(seconds) });
            return;
        }
        if (head === dialect.text.interpolation) {
            const marks = marksNow();
            const source = argument ?? "";
            runs.push(marks === undefined ? { interpolation: source } : { interpolation: source, marks });
            return;
        }
        if (head === dialect.text.unknown) {
            // The stand-in for a value no script can say. It cannot be turned back into one, so the
            // caller is told rather than handed a run that pretends to carry something.
            report("unknownTag", index, head);
            return;
        }
        const spec = dialect.text.marks.find((entry) => entry.tag === head);
        if (!spec) {
            report("unknownTag", index, head);
            return;
        }
        const value = spec.arg === undefined
            ? true
            : spec.arg === "number"
                ? Number(argument ?? "0")
                : readTagArgument(argument ?? "", dialect);
        open.push({ mark: spec.mark, value });
    }
}

/**
 * Where a tag ends: the first closing fence that is not inside a quoted argument.
 *
 * A tag's argument may be quoted (`{color "rgb(56, 189, 248)"}`), and a quoted string can hold
 * anything at all - including the fence. Scanning for the fence alone would end the tag inside its own
 * argument.
 */
function findFenceClose(raw: string, from: number, close: string, dialect: NarralangDialect): number {
    const [open, shut] = dialect.quote.string;
    const mark = dialect.escape;
    let index = from;
    let inString = false;
    while (index < raw.length) {
        if (mark !== "" && raw.startsWith(mark, index)) {
            index += mark.length + 1;
            continue;
        }
        if (!inString && open !== "" && raw.startsWith(open, index)) {
            inString = true;
            index += open.length;
            continue;
        }
        if (inString && shut !== "" && raw.startsWith(shut, index)) {
            inString = false;
            index += shut.length;
            continue;
        }
        if (!inString && raw.startsWith(close, index)) {
            return index;
        }
        index += 1;
    }
    return -1;
}

/** A tag argument as it was authored: the quotes taken off and the escapes decoded, when it has any. */
function readTagArgument(value: string, dialect: NarralangDialect): string {
    const [open, close] = dialect.quote.string;
    if (open === "" || !value.startsWith(open) || !value.endsWith(close) || value.length < open.length + close.length) {
        return value;
    }
    return decodeNarralangEscapes(value.slice(open.length, value.length - close.length), dialect);
}

function sameMarks(left: StoryTextMarks | undefined, right: StoryTextMarks | undefined): boolean {
    if (left === undefined || right === undefined) {
        return left === right;
    }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
        if (left[key as keyof StoryTextMarks] !== right[key as keyof StoryTextMarks]) {
            return false;
        }
    }
    return true;
}
