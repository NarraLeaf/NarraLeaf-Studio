/**
 * Syntax colouring for NarraLang, derived from the same dialect the printer spells with.
 *
 * Design doc: `docs/plans/2026-08-15-001-plan-narralang.md`.
 *
 * ## Why this is not a Monarch grammar
 *
 * Monarch would mean a second copy of the vocabulary written as regular expressions, and the whole
 * argument of {@link ./narralangDialect} is that the vocabulary is a value nobody may restate. Every
 * table below is computed from the dialect, so a project that renames a verb, moves a modifier onto a
 * different preposition or fences rich text with `[i]` gets its colours moved with it and this file
 * stays as it is.
 *
 * The second reason is mechanical. Monarch carries its tokenizer state from the end of one line into
 * the start of the next, and NarraLang lines are independent - a state that failed to unwind at a line
 * ending would tint the whole rest of the scene. A line-at-a-time function has no state to leak, and
 * it is testable without Monaco, which a grammar handed to `setMonarchTokensProvider` is not.
 *
 * ## No locale, ever
 *
 * The same rule the printer lives by: nothing here may reach `translate` or the localised command
 * tables. What the colours key off is what is written in the file, and the file has no locale.
 */

import { narralangDialectKeywords, type NarralangDialect } from "./narralangDialect";

/**
 * The scopes a NarraLang line is painted in.
 *
 * Deliberately Monaco's own generic token names rather than a private vocabulary: the Studio theme
 * already gives every one of them a colour from the workspace palette, so this surface inherits the
 * accent and the theme without a second palette to keep in step.
 */
export type NarralangScope =
    /** Prose, and anything the language does not mark. */
    | ""
    /** A note row, the marker on a switched-off row, and a row nothing could read. */
    | "comment"
    /** A word that opens a statement, and the scene header. */
    | "keyword"
    /** The preposition a modifier hangs off (`at`, `with`, `over`, `until`). */
    | "type"
    /** Who says the line. */
    | "attribute.name"
    /** A quoted name or a string literal. */
    | "string"
    /** A number, a duration, a colour. */
    | "number"
    /** A rich-text fence, and the sigil addressing a stage singleton. */
    | "tag"
    /** The block opener, the speaker separator, and the escape that demotes a line to prose. */
    | "delimiter";

/** Where a run of one scope begins on the line. A run ends where the next one starts. */
export type NarralangToken = {
    readonly start: number;
    readonly scope: NarralangScope;
};

// --- Derived tables -------------------------------------------------------------------------------

type Tables = {
    /** Full verb spellings and the scene header, longest first so `image create` beats `image`. */
    readonly phrases: readonly string[];
    /** Every lead word any slot hangs off, longest first so `show if` beats `show`. */
    readonly leads: readonly string[];
    /** Verbs whose entire tail is one text slot, so what follows the keyword is prose. */
    readonly proseVerbs: ReadonlySet<string>;
};

const TABLES_CACHE = new WeakMap<NarralangDialect, Tables>();

/** Longest first; ties broken alphabetically so the table is stable between runs. */
function byLengthDesc(a: string, b: string): number {
    return b.length - a.length || (a < b ? -1 : a > b ? 1 : 0);
}

function tablesFor(dialect: NarralangDialect): Tables {
    const cached = TABLES_CACHE.get(dialect);
    if (cached) {
        return cached;
    }
    // The single-word openers come from the printer's own escape set, never from a list kept here:
    // the words prose has to be escaped against and the words painted as statements must be the same
    // words, or a renamed verb would quietly stop being one of them on exactly one of the two sides.
    const phrases = new Set<string>(narralangDialectKeywords(dialect));
    if (dialect.sceneKeyword !== "") {
        phrases.add(dialect.sceneKeyword);
    }
    const leads = new Set<string>();
    const proseVerbs = new Set<string>();
    const textOnly = new Map<string, boolean>();
    for (const syntax of Object.values(dialect.verbs)) {
        if (syntax.keyword !== "") {
            phrases.add(syntax.keyword);
        }
        for (const slot of syntax.slots) {
            if (slot.lead !== undefined && slot.lead !== "") {
                leads.add(slot.lead);
            }
        }
        if (syntax.keyword === "") {
            continue;
        }
        // A keyword can be shared (`show` covers characters, images, layers and the raw channel), so
        // "what follows is prose" has to hold for EVERY verb spelled that way before it can be true
        // for the spelling. `menu` is the only one in the default dialect.
        const isText = syntax.slots.length === 1 && slotAcceptsOnly(syntax.slots[0], "text");
        textOnly.set(syntax.keyword, (textOnly.get(syntax.keyword) ?? true) && isText);
    }
    for (const [keyword, isText] of textOnly) {
        if (isText) {
            proseVerbs.add(keyword);
        }
    }
    const tables: Tables = {
        phrases: [...phrases].sort(byLengthDesc),
        leads: [...leads].sort(byLengthDesc),
        proseVerbs,
    };
    TABLES_CACHE.set(dialect, tables);
    return tables;
}

function slotAcceptsOnly(slot: NarralangDialect["verbs"][keyof NarralangDialect["verbs"]]["slots"][number], kind: string): boolean {
    return Array.isArray(slot.value) ? slot.value.length === 1 && slot.value[0] === kind : slot.value === kind;
}

// --- The line scanner -----------------------------------------------------------------------------

const NUMBER = /^-?\d+(?:\.\d+)?$/;
const COLOUR = /^#[0-9a-fA-F]{3,8}$/;

class Line {
    readonly tokens: NarralangToken[] = [];

    constructor(readonly text: string, readonly dialect: NarralangDialect, readonly tables: Tables) {
        this.tokens.push({ start: 0, scope: "" });
    }

    /** Open a run. Repeating the scope, or reopening at the same offset, replaces rather than stacks. */
    at(start: number, scope: NarralangScope): void {
        // A run that starts where the line ends covers nothing. Emitting it would leave the last
        // token of a line pointing past its own text, which Monaco has no offset for.
        if (start >= this.text.length) {
            return;
        }
        const last = this.tokens[this.tokens.length - 1];
        if (last.start === start) {
            this.tokens[this.tokens.length - 1] = { start, scope };
            return;
        }
        if (last.scope !== scope) {
            this.tokens.push({ start, scope });
        }
    }

    /** True when the character at `index` is preceded by an unconsumed escape. */
    escaped(index: number): boolean {
        const mark = this.dialect.escape;
        if (mark === "" || index < mark.length) {
            return false;
        }
        let count = 0;
        let probe = index - mark.length;
        while (probe >= 0 && this.text.startsWith(mark, probe)) {
            count += 1;
            probe -= mark.length;
        }
        return count % 2 === 1;
    }

    /**
     * The end of a fenced run whose opening mark ends at `after`, past its closing mark.
     *
     * An unclosed fence runs to the end of the line rather than swallowing the rest of the scene -
     * this is a projection of a live document, so a half-typed tag is a normal intermediate state and
     * must not be able to grey out everything below it.
     */
    fenceEnd(after: number, close: string): number {
        let probe = after;
        while (probe < this.text.length) {
            if (this.text.startsWith(close, probe) && !this.escaped(probe)) {
                return probe + close.length;
            }
            probe += 1;
        }
        return this.text.length;
    }
}

/** The dialect word at `from`, if one of `phrases` sits there as a whole token. */
function phraseAt(line: Line, from: number, phrases: readonly string[]): string | null {
    for (const phrase of phrases) {
        if (phrase === "" || !line.text.startsWith(phrase, from)) {
            continue;
        }
        const after = line.text[from + phrase.length];
        // A phrase only counts when the next thing is a boundary - otherwise `set` would swallow the
        // first three letters of a stage object called `settings`.
        if (after === undefined || after === " " || after === "\t" || line.text.startsWith(line.dialect.block.open, from + phrase.length)) {
            return phrase;
        }
    }
    return null;
}

/**
 * The speaker separator that splits a dialogue line, or -1 when the line is not one.
 *
 * Quoted runs and escaped characters are skipped, which is what makes narration safe: the printer
 * escapes `: ` in prose (see `escapeNarralangProse`), so an unescaped one is always the real
 * separator. The trailing block opener of a choice option is excluded by requiring text after the
 * separator - a line ending in `:` opens a block, it does not say anything.
 */
function separatorAt(line: Line, from: number): number {
    const { escape, speakerSeparator, quote } = line.dialect;
    let probe = from;
    while (probe < line.text.length) {
        if (escape !== "" && line.text.startsWith(escape, probe)) {
            probe += escape.length + 1;
            continue;
        }
        if (line.text.startsWith(quote.name[0], probe)) {
            probe = line.fenceEnd(probe + quote.name[0].length, quote.name[1]);
            continue;
        }
        if (line.text.startsWith(quote.string[0], probe)) {
            probe = line.fenceEnd(probe + quote.string[0].length, quote.string[1]);
            continue;
        }
        if (speakerSeparator !== "" && line.text.startsWith(speakerSeparator, probe)) {
            const tail = line.text.slice(probe + speakerSeparator.length);
            if (tail.startsWith(" ") && tail.trim() !== "") {
                return probe;
            }
        }
        probe += 1;
    }
    return -1;
}

/** The trailing block opener, or -1. Reported separately so both scanners can stop before it. */
function blockOpenAt(line: Line, to: number): number {
    const open = line.dialect.block.open;
    if (open === "" || to < open.length) {
        return -1;
    }
    const start = to - open.length;
    return line.text.startsWith(open, start) && !line.escaped(start) ? start : -1;
}

/** Rich text: everything is prose except the brace tags, which are the language's own vocabulary. */
function scanProse(line: Line, from: number, to: number): void {
    const { escape, text } = line.dialect;
    line.at(from, "");
    let probe = from;
    while (probe < to) {
        if (escape !== "" && line.text.startsWith(escape, probe)) {
            probe += escape.length + 1;
            continue;
        }
        if (text.open !== "" && line.text.startsWith(text.open, probe)) {
            const end = Math.min(line.fenceEnd(probe + text.open.length, text.close), to);
            line.at(probe, "tag");
            line.at(end, "");
            probe = end;
            continue;
        }
        probe += 1;
    }
}

/** One whitespace-delimited token, past its closing quote when it opens one. */
function tokenEnd(line: Line, from: number, to: number): number {
    const { quote } = line.dialect;
    if (line.text.startsWith(quote.name[0], from)) {
        return Math.min(line.fenceEnd(from + quote.name[0].length, quote.name[1]), to);
    }
    if (line.text.startsWith(quote.string[0], from)) {
        return Math.min(line.fenceEnd(from + quote.string[0].length, quote.string[1]), to);
    }
    let probe = from;
    while (probe < to && line.text[probe] !== " " && line.text[probe] !== "\t") {
        probe += 1;
    }
    return probe;
}

function classify(line: Line, token: string): NarralangScope {
    const { quote, prefix } = line.dialect;
    if (token.startsWith(quote.name[0]) || token.startsWith(quote.string[0])) {
        return "string";
    }
    if (prefix.builtin !== "" && token.startsWith(prefix.builtin)) {
        return "tag";
    }
    if (NUMBER.test(token) || COLOUR.test(token)) {
        return "number";
    }
    return "";
}

/**
 * The tail of a statement: prepositions painted as structure, values by what they are, everything
 * else left alone.
 *
 * `speaker` marks the head of a dialogue line, where the first token is who is talking. It is the one
 * position in the language whose meaning comes from where it sits rather than from a word in front of
 * it, which is why it is a flag here and not another entry in the lead table.
 */
function scanStatement(line: Line, from: number, to: number, speaker: boolean): void {
    let probe = from;
    let first = true;
    while (probe < to) {
        if (line.text[probe] === " " || line.text[probe] === "\t") {
            line.at(probe, "");
            probe += 1;
            continue;
        }
        const lead = first && speaker ? null : phraseAt(line, probe, line.tables.leads);
        if (lead !== null) {
            line.at(probe, "type");
            probe += lead.length;
            line.at(probe, "");
            first = false;
            continue;
        }
        const end = tokenEnd(line, probe, to);
        const token = line.text.slice(probe, end);
        line.at(probe, first && speaker ? "attribute.name" : classify(line, token));
        line.at(end, "");
        probe = end;
        first = false;
    }
}

/**
 * One line of NarraLang as coloured runs.
 *
 * Stateless by construction - a line is read on its own, exactly as the language defines it - so the
 * caller never has to thread a tokenizer state and a malformed line cannot tint the rest of the
 * scene.
 */
export function tokenizeNarralangLine(text: string, dialect: NarralangDialect): NarralangToken[] {
    const line = new Line(text, dialect, tablesFor(dialect));
    const { prefix, escape } = dialect;

    let from = 0;
    while (from < text.length && (text[from] === " " || text[from] === "\t")) {
        from += 1;
    }
    if (from >= text.length) {
        return line.tokens;
    }

    // A row nothing could ever read carries a doubled marker, and it is a comment for the same reason
    // a note is: the rest of it is not script, it is the raw line the row is holding on to.
    if (prefix.disabled !== "" && text.startsWith(prefix.disabled + prefix.disabled, from)) {
        line.at(from, "comment");
        return line.tokens;
    }
    if (prefix.note !== "" && text.startsWith(prefix.note, from)) {
        line.at(from, "comment");
        return line.tokens;
    }
    // A switched-off row keeps its own colours - what it says is still what it would do - so only the
    // marker is greyed and the scan carries on from behind it.
    if (prefix.disabled !== "" && text.startsWith(prefix.disabled, from)) {
        line.at(from, "comment");
        from += prefix.disabled.length;
        line.at(from, "");
        while (from < text.length && text[from] === " ") {
            from += 1;
        }
    }
    if (from >= text.length) {
        return line.tokens;
    }

    // The escape says "this line is prose whatever its first word looks like". Honouring it here is
    // what keeps a narration line beginning with `show` from being painted as a statement.
    if (escape !== "" && text.startsWith(escape, from)) {
        line.at(from, "delimiter");
        line.at(from + escape.length, "");
        scanProse(line, from + escape.length, text.length);
        return line.tokens;
    }

    const blockOpen = blockOpenAt(line, text.length);
    const body = blockOpen === -1 ? text.length : blockOpen;

    const phrase = phraseAt(line, from, line.tables.phrases);
    if (phrase !== null) {
        line.at(from, "keyword");
        const after = Math.min(from + phrase.length, body);
        line.at(after, "");
        if (line.tables.proseVerbs.has(phrase)) {
            scanProse(line, after, body);
        } else {
            scanStatement(line, after, body, false);
        }
    } else {
        const separator = separatorAt(line, from);
        if (separator !== -1) {
            scanStatement(line, from, separator, true);
            line.at(separator, "delimiter");
            const spoken = separator + dialect.speakerSeparator.length;
            line.at(spoken, "");
            scanProse(line, spoken, text.length);
            return line.tokens;
        }
        scanProse(line, from, body);
    }

    if (blockOpen !== -1) {
        line.at(blockOpen, "delimiter");
    }
    return line.tokens;
}
