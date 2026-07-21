import {
    findParam,
    isFlagParam,
    matchEnumOption,
    paramTypes,
    positionalParams,
    type StoryCommandDef,
    type StoryCommandParam,
    type StoryCommandParamType,
} from "./storyCommandGrammar";
import { getCommandDef } from "./commands/registry";
import type { StoryCommandSpan } from "./storyCommandValues";

export type { StoryCommandSpan };

/**
 * Parser for the story editor's slash command line: source text → structured args + issues.
 *
 * The whole insert row is classified here, not just command lines, so the editor's state is a pure
 * function of (text, cursor) with no separate `chooser` flag to drift out of sync.
 *
 * The parser is context-free by construction: it validates what the grammar alone can decide (enum
 * membership, number format, unknown/duplicate keys) and stays silent about anything needing project
 * state (does `forest_day` exist? does `100` fit `gold`'s declared type?). Those are the resolution
 * layer's, which has the services the parser must not import. An arg that parses is not yet an arg
 * that resolves.
 */

export type StoryCommandToken = {
    /** Token text with quotes removed. */
    text: string;
    /** Source text of the token, quotes included. */
    raw: string;
    span: StoryCommandSpan;
    quoted: boolean;
    /**
     * Which quote wrapped the token: `"` is a string, `'` is an entity reference. Advisory for now -
     * both kinds group identically and resolution reads the stripped text either way - but recorded
     * so a stricter pass can tell `/set "gold" 1` from `/set 'gold' 1` later. When a token mixes both
     * kinds (not a real case), the first structural quote wins. Unset on bare tokens.
     */
    quote?: "double" | "single";
};

export type StoryCommandArg = {
    /** The param this arg fills, or null when the key matched nothing in the grammar. */
    param: StoryCommandParam | null;
    /** The key as typed, or null for a positional arg. */
    key: string | null;
    keySpan?: StoryCommandSpan;
    value: string;
    valueSpan: StoryCommandSpan;
};

export type StoryCommandIssue =
    | { code: "unknownCommand"; span: StoryCommandSpan; token: string }
    | { code: "unknownParam"; span: StoryCommandSpan; key: string }
    | { code: "duplicateParam"; span: StoryCommandSpan; key: string }
    | { code: "extraPositional"; span: StoryCommandSpan; value: string }
    | { code: "badValue"; span: StoryCommandSpan; value: string; expected: readonly StoryCommandParamType[] }
    | { code: "unterminatedQuote"; span: StoryCommandSpan };

export type StoryCommandLine =
    | { kind: "empty" }
    | { kind: "narration"; text: string }
    /** A `#name …` line. Equivalent to `/say name …`; both routes are kept. */
    | { kind: "character"; query: string; querySpan: StoryCommandSpan; text: string; textSpan: StoryCommandSpan }
    | {
          kind: "command";
          /** The command token as typed, or null when nothing follows the slash yet. */
          token: string | null;
          tokenSpan: StoryCommandSpan;
          /** null when the token matches no command - `issues` then carries `unknownCommand`. */
          def: StoryCommandDef | null;
          args: StoryCommandArg[];
          issues: StoryCommandIssue[];
      };

/**
 * Split on unquoted whitespace, keeping absolute spans. Both quote kinds group and there is no escape
 * syntax (an asset name containing a quote is not a real case): `"…"` marks a string, `'…'` an entity
 * reference - same shape, different intent, recorded on the token's `quote`. Inside one kind the
 * other is data, so `"Bob's Bar"` keeps its apostrophe and `'say "hi"'` its quotes.
 */
export function tokenizeCommandLine(source: string, from = 0): { tokens: StoryCommandToken[]; unterminatedQuote: boolean } {
    const tokens: StoryCommandToken[] = [];
    let unterminatedQuote = false;
    let index = from;

    while (index < source.length) {
        while (index < source.length && source[index] === " ") {
            index += 1;
        }
        if (index >= source.length) {
            break;
        }
        const start = index;
        let text = "";
        let quote: "double" | "single" | undefined;
        let inQuote: "\"" | "'" | null = null;
        while (index < source.length) {
            const char = source[index];
            if ((char === "\"" || char === "'") && (inQuote === null || inQuote === char)) {
                inQuote = inQuote === null ? char : null;
                quote ??= char === "\"" ? "double" : "single";
                index += 1;
                continue;
            }
            if (char === " " && inQuote === null) {
                break;
            }
            text += char;
            index += 1;
        }
        if (inQuote !== null) {
            unterminatedQuote = true;
        }
        tokens.push({
            text,
            raw: source.slice(start, index),
            span: { start, end: index },
            quoted: quote !== undefined,
            ...(quote ? { quote } : {}),
        });
    }

    return { tokens, unterminatedQuote };
}

/** Index of the first `=` outside quotes, or -1. `t="a b"` splits at 1; a `=` inside either quote kind is data. */
function firstUnquotedEquals(raw: string): number {
    let inQuote: "\"" | "'" | null = null;
    for (let index = 0; index < raw.length; index += 1) {
        const char = raw[index];
        if ((char === "\"" || char === "'") && (inQuote === null || inQuote === char)) {
            inQuote = inQuote === null ? char : null;
            continue;
        }
        if (char === "=" && inQuote === null) {
            return index;
        }
    }
    return -1;
}

/** Remove the structural quotes of either kind, keeping the other kind's characters as data. */
function stripQuotes(raw: string): string {
    let inQuote: "\"" | "'" | null = null;
    let text = "";
    for (const char of raw) {
        if ((char === "\"" || char === "'") && (inQuote === null || inQuote === char)) {
            inQuote = inQuote === null ? char : null;
            continue;
        }
        text += char;
    }
    return text;
}

function acceptsType(type: StoryCommandParamType, value: string): boolean {
    switch (type.kind) {
        case "enum":
            return matchEnumOption(type, value) !== null;
        case "keyword":
            return value.trim().toLowerCase() === type.value.toLowerCase();
        case "number": {
            const parsed = Number(value);
            if (value.trim() === "" || !Number.isFinite(parsed)) {
                return false;
            }
            if (type.integer && !Number.isInteger(parsed)) {
                return false;
            }
            if (type.min !== undefined && parsed < type.min) {
                return false;
            }
            return !(type.max !== undefined && parsed > type.max);
        }
        case "boolean":
            // Flags accept the human spellings too; resolution canonicalizes to true/false (bible B5).
            return ["true", "false", "on", "off", "yes", "no"].includes(value.trim().toLowerCase());
        case "color":
            return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim());
        // Context-dependent or unconstrained: the parser has nothing to check against.
        case "asset":
        case "character":
        case "characterForm":
        case "scene":
        case "variable":
        case "target":
        case "content":
        case "literal":
        case "constant":
        case "text":
        // An expression's validity depends on which variables exist, so the parser - which by
        // construction has no project state - has nothing to check. Resolution parses it for real.
        case "expression":
            return true;
    }
}

/**
 * Whether the grammar alone can reject this value. A value is bad only when EVERY branch of the
 * union rejects it, and only when at least one branch is checkable at all - `/bg forest_day` must
 * not be flagged just because `forest_day` fails the `color` branch, since the `asset` branch is
 * unresolvable here and might well accept it.
 */
function isBadValue(param: StoryCommandParam, value: string): boolean {
    if (!value) {
        return false;
    }
    return !paramTypes(param).some(type => acceptsType(type, value));
}

/** Checkable kinds only - what the skippable rule may dispatch on. An uncheckable branch never "strictly matches". */
function strictlyMatches(param: StoryCommandParam, value: string): boolean {
    if (!value) {
        return false;
    }
    return paramTypes(param).some(type => {
        switch (type.kind) {
            case "enum":
            case "keyword":
            case "number":
            case "boolean":
            case "color":
                return acceptsType(type, value);
            default:
                return false;
        }
    });
}

function parseCommand(source: string): Extract<StoryCommandLine, { kind: "command" }> {
    const { tokens, unterminatedQuote } = tokenizeCommandLine(source, 1);
    const issues: StoryCommandIssue[] = [];
    if (unterminatedQuote) {
        issues.push({ code: "unterminatedQuote", span: { start: source.length, end: source.length } });
    }

    const nameToken = tokens[0];
    if (!nameToken) {
        return { kind: "command", token: null, tokenSpan: { start: 1, end: 1 }, def: null, args: [], issues };
    }

    const def = getCommandDef(nameToken.text);
    if (!def) {
        issues.push({ code: "unknownCommand", span: nameToken.span, token: nameToken.text });
        return { kind: "command", token: nameToken.text, tokenSpan: nameToken.span, def: null, args: [], issues };
    }

    const args: StoryCommandArg[] = [];
    const positionals = positionalParams(def);
    const seen = new Set<string>();
    let positionalIndex = 0;

    for (let index = 1; index < tokens.length; index += 1) {
        const token = tokens[index];
        const equals = firstUnquotedEquals(token.raw);

        // A greedy param claims the rest of the line, and it has to win against the `key=value` split
        // *unless* the token really is one of this command's params.
        //
        // Both halves matter. Without the greedy check first, `/set gold += 1` splits at the `=` into
        // a param named `+` and the expression never reaches the resolver. Without the "is it a real
        // param" exception, `/text name=hero Hello` loses its documented leading `name=` handle,
        // because the greedy content would claim `name=hero` as prose.
        //
        // So the question a token has to answer is not "does it contain `=`" but "does it name
        // something this command declares" - which is the same question the named branch below asks,
        // just asked one step earlier.
        const pending = positionals[positionalIndex];
        const namesRealParam = equals > 0 && findParam(def, token.raw.slice(0, equals)) !== null;
        if (pending?.greedy && !namesRealParam) {
            const span = { start: token.span.start, end: source.length };
            seen.add(pending.name);
            args.push({ param: pending, key: null, value: source.slice(span.start), valueSpan: span });
            // A quote left open is not an error inside greedy prose: the value is the raw tail, quote
            // characters and all, so nothing about the arg that lands is unterminated. This is what
            // keeps `/say alice don't worry` committable now that `'` is quote syntax - an unclosed
            // quote runs to the end of the line, so it always sits inside the claimed tail.
            const kept = issues.filter(issue => issue.code !== "unterminatedQuote");
            return { kind: "command", token: nameToken.text, tokenSpan: nameToken.span, def, args, issues: kept };
        }

        if (equals > 0) {
            const key = token.raw.slice(0, equals);
            const value = stripQuotes(token.raw.slice(equals + 1));
            const keySpan = { start: token.span.start, end: token.span.start + equals };
            const valueSpan = { start: token.span.start + equals + 1, end: token.span.end };
            const param = findParam(def, key);
            if (!param) {
                issues.push({ code: "unknownParam", span: keySpan, key });
            } else if (seen.has(param.name)) {
                issues.push({ code: "duplicateParam", span: keySpan, key });
            } else {
                seen.add(param.name);
                if (isBadValue(param, value)) {
                    issues.push({ code: "badValue", span: valueSpan, value, expected: paramTypes(param) });
                }
            }
            args.push({ param, key, keySpan, value, valueSpan });
            continue;
        }

        // A bare token naming an unfilled named boolean is a flag: `/bgm battle loop` (bible B5).
        // Bound only after the first positional has been consumed (or when there are none), so a
        // leading value that happens to spell a flag name still fills the slot the author meant.
        const flagParam = findParam(def, token.text);
        if (flagParam && isFlagParam(flagParam) && !seen.has(flagParam.name) && (positionalIndex > 0 || positionals.length === 0)) {
            seen.add(flagParam.name);
            args.push({ param: flagParam, key: token.text, keySpan: token.span, value: "true", valueSpan: token.span });
            continue;
        }

        let param = positionals[positionalIndex];
        if (!param) {
            issues.push({ code: "extraPositional", span: token.span, value: token.text });
            args.push({ param: null, key: null, value: token.text, valueSpan: token.span });
            continue;
        }

        // An omissible leading positional (bible B4): when the token strictly matches the NEXT
        // positional's closed value set and not this one's, this slot was skipped, not filled -
        // `/vol 0.5` is a volume with the default target, not a sound named "0.5".
        if (param.skippable) {
            const next = positionals[positionalIndex + 1];
            if (next && !seen.has(next.name) && strictlyMatches(next, token.text) && !strictlyMatches(param, token.text)) {
                positionalIndex += 1;
                param = next;
            }
        }

        positionalIndex += 1;
        seen.add(param.name);

        if (isBadValue(param, token.text)) {
            issues.push({ code: "badValue", span: token.span, value: token.text, expected: paramTypes(param) });
        }
        args.push({ param, key: null, value: token.text, valueSpan: token.span });
    }

    return { kind: "command", token: nameToken.text, tokenSpan: nameToken.span, def, args, issues };
}

function parseCharacterLine(source: string): Extract<StoryCommandLine, { kind: "character" }> {
    const rest = source.slice(1);
    const boundary = rest.indexOf(" ");
    const query = boundary === -1 ? rest : rest.slice(0, boundary);
    const textStart = boundary === -1 ? source.length : boundary + 2;
    return {
        kind: "character",
        query,
        querySpan: { start: 1, end: 1 + query.length },
        text: boundary === -1 ? "" : source.slice(textStart),
        textSpan: { start: textStart, end: source.length },
    };
}

/**
 * Classify and parse an insert-row line.
 *
 * `/` and `#` are triggers only at the start of an empty line - mid-line they are ordinary
 * characters, or `他/她` and `#1` would turn into commands. The caller enforces the "empty line"
 * half of that rule; this function owns the "line starts with" half.
 */
export function parseCommandLine(source: string): StoryCommandLine {
    if (!source) {
        return { kind: "empty" };
    }
    if (source.startsWith("/")) {
        return parseCommand(source);
    }
    if (source.startsWith("#")) {
        return parseCharacterLine(source);
    }
    return { kind: "narration", text: source };
}

/** The value of a named or positional arg by param name, or undefined when unfilled. */
export function getArgValue(line: Extract<StoryCommandLine, { kind: "command" }>, paramName: string): string | undefined {
    return line.args.find(arg => arg.param?.name === paramName)?.value;
}

/** Params with no arg yet - the candidate source for the param-name stage, and the ghost hint. */
export function unfilledParams(line: Extract<StoryCommandLine, { kind: "command" }>): readonly StoryCommandParam[] {
    if (!line.def) {
        return [];
    }
    const filled = new Set(line.args.map(arg => arg.param?.name).filter(Boolean));
    return line.def.params.filter(param => !filled.has(param.name));
}

/**
 * Whether the line may be committed as its action. Issues always block; unfilled params block when
 * they are part of the command's required core (bible B9) - a committed row is always a complete,
 * working instruction. An incomplete line is not lost: the commit path lands it as a draft row, and
 * the reason line names the missing slot.
 */
export function canCommit(line: StoryCommandLine): boolean {
    switch (line.kind) {
        case "empty":
            return false;
        case "narration":
            return line.text.trim().length > 0;
        case "character":
            return line.query.trim().length > 0;
        case "command":
            if (!line.def || line.issues.length > 0) {
                return false;
            }
            return !unfilledParams(line).some(param => param.core);
    }
}

/** The unfilled core params - what the reason line names when Enter lands a draft instead of a row. */
export function missingCoreParams(line: StoryCommandLine): readonly StoryCommandParam[] {
    if (line.kind !== "command" || !line.def) {
        return [];
    }
    return unfilledParams(line).filter(param => param.core);
}
