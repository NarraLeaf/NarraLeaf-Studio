import { getCommandDef, paramTypes, positionalParams, type StoryCommandDef, type StoryCommandParam } from "./storyCommandGrammar";
import { tokenizeCommandLine, type StoryCommandSpan, type StoryCommandToken } from "./storyCommandParser";

/**
 * Where the caret is, and therefore what the slot should offer.
 *
 * A pure function of (text, caret) - the editor's chooser state is derived, never stored. The one
 * thing it cannot derive is whether the author pressed Escape: `EditorMode.insert.chooserDismissed`
 * stays on the slot, because "the menu was dismissed" is not in the text (see the plan's §4.1).
 */

export type StoryCommandCursor =
    | { kind: "none" }
    /** After `/`, still naming the command. */
    | { kind: "commandName"; query: string; replace: StoryCommandSpan }
    /** A positional slot: the image in `/bg …`, the speaker in `/say …`. */
    | { kind: "positional"; param: StoryCommandParam; query: string; replace: StoryCommandSpan }
    /** Between args, naming the next one: the `t=` / `d=` of `/bg forest …`. */
    | { kind: "paramName"; params: readonly StoryCommandParam[]; query: string; replace: StoryCommandSpan }
    /** After `key=`, giving that param's value. */
    | { kind: "paramValue"; param: StoryCommandParam; query: string; replace: StoryCommandSpan }
    /** Inside free text that runs to the end of the line. No candidates, by nature. */
    | { kind: "greedy" }
    /** Inside a greedy expression. `query` is the identifier fragment at the caret, not the whole line. */
    | { kind: "expression"; param: StoryCommandParam; query: string; replace: StoryCommandSpan }
    /** After `#`, naming the speaker. */
    | { kind: "characterName"; query: string; replace: StoryCommandSpan };

/**
 * Whether the first candidate should be highlighted when the list opens.
 *
 * This is the rule the interaction model calls the one most likely to be lost, so it lives here
 * rather than in the component: **must-pick positions default-highlight; optional-next-step positions
 * do not.** The highlight is Enter's pointer - Tab and Enter both take it - so highlighting `t=` in
 * `/bg forest_day ` would mean Enter grabs `t=` instead of submitting, and the line could never be
 * committed without an extra Escape.
 *
 * `paramName` still *shows* its candidates: listing them is how an author discovers what else the
 * command takes. Showing and selecting are different things.
 */
export function defaultHighlights(cursor: StoryCommandCursor): boolean {
    switch (cursor.kind) {
        case "commandName":
        case "characterName":
        case "positional":
        case "paramValue":
            return true;
        case "paramName":
        case "greedy":
        // An expression must not default-highlight. The author is writing, not picking: Enter has to
        // mean "commit this line", or `/set gold gold + 1` would grab whatever variable the menu
        // happened to be showing instead of submitting. Tab still takes the highlight.
        case "expression":
        case "none":
            return false;
    }
}

/** The token the caret sits in or against, or null when it sits in whitespace. */
function tokenAtCaret(tokens: readonly StoryCommandToken[], caret: number): StoryCommandToken | null {
    return tokens.find(token => caret >= token.span.start && caret <= token.span.end) ?? null;
}

/** Index of the first `=` outside quotes, or -1. Mirrors the parser's own splitting. */
function firstUnquotedEquals(raw: string): number {
    let inQuote = false;
    for (let index = 0; index < raw.length; index += 1) {
        if (raw[index] === "\"") {
            inQuote = !inQuote;
            continue;
        }
        if (raw[index] === "=" && !inQuote) {
            return index;
        }
    }
    return -1;
}

function stripQuotes(raw: string): string {
    return raw.replace(/"/g, "");
}

/** Positional params already satisfied by tokens strictly before the caret's own token. */
function positionalIndexBefore(tokens: readonly StoryCommandToken[], activeStart: number): number {
    let index = 0;
    for (const token of tokens.slice(1)) {
        if (token.span.start >= activeStart) {
            break;
        }
        if (firstUnquotedEquals(token.raw) <= 0) {
            index += 1;
        }
    }
    return index;
}

function paramsNotYetNamed(def: StoryCommandDef, tokens: readonly StoryCommandToken[], activeStart: number): StoryCommandParam[] {
    const named = new Set<string>();
    for (const token of tokens.slice(1)) {
        if (token.span.start >= activeStart) {
            continue;
        }
        const equals = firstUnquotedEquals(token.raw);
        if (equals > 0) {
            named.add(token.raw.slice(0, equals).toLowerCase());
        }
    }
    return def.params.filter(param => !param.positional && !named.has(param.name.toLowerCase()));
}

function commandCursor(source: string, caret: number): StoryCommandCursor {
    const { tokens } = tokenizeCommandLine(source, 1);
    const nameToken = tokens[0];

    // Still on the command name: no token yet, or the caret is inside the first one.
    if (!nameToken || caret <= nameToken.span.end) {
        const span = nameToken ? nameToken.span : { start: 1, end: 1 };
        return { kind: "commandName", query: nameToken ? nameToken.text.slice(0, caret - nameToken.span.start) : "", replace: span };
    }

    const def = getCommandDef(nameToken.text);
    if (!def) {
        return { kind: "none" };
    }

    const active = tokenAtCaret(tokens.slice(1), caret);
    const activeStart = active ? active.span.start : caret;
    const replace: StoryCommandSpan = active ? active.span : { start: caret, end: caret };

    // `key=value` - the caret is past the `=`, so it is giving that param's value.
    if (active) {
        const equals = firstUnquotedEquals(active.raw);
        if (equals > 0 && caret > active.span.start + equals) {
            const param = def.params.find(candidate =>
                candidate.name === active.raw.slice(0, equals).toLowerCase()
                || (candidate.aliases ?? []).includes(active.raw.slice(0, equals).toLowerCase()));
            if (!param) {
                return { kind: "none" };
            }
            return {
                kind: "paramValue",
                param,
                query: stripQuotes(active.raw.slice(equals + 1, caret - active.span.start)),
                replace: { start: active.span.start + equals + 1, end: active.span.end },
            };
        }
    }

    const positionals = positionalParams(def);
    const index = positionalIndexBefore(tokens, activeStart);

    // A greedy param runs to the end of the line, so everything from where it starts is prose - the
    // positional counter must stop there rather than reading `hello there` as two more arguments.
    const greedyIndex = positionals.findIndex(param => param.greedy);
    if (greedyIndex >= 0 && index >= greedyIndex) {
        const greedy = positionals[greedyIndex];
        // A greedy *expression* is the exception: it runs to the end of the line like prose, but it is
        // made of names the author should be picking rather than remembering. So instead of giving up
        // on candidates, narrow the query to the identifier fragment the caret sits in - `/set gold go`
        // offers `gold`, and completing it replaces `go` rather than the whole expression.
        if (paramTypes(greedy).some(type => type.kind === "expression")) {
            return expressionCursor(greedy, source, caret, tokens[greedyIndex + 1]?.span.start ?? caret);
        }
        return { kind: "greedy" };
    }

    const param = positionals[index];
    if (param) {
        const query = active ? active.text.slice(0, caret - active.span.start) : "";
        return { kind: "positional", param, query, replace };
    }

    const query = active ? active.text.slice(0, caret - active.span.start) : "";
    return { kind: "paramName", params: paramsNotYetNamed(def, tokens, activeStart), query, replace };
}

/**
 * Identifier characters, matching the expression tokenizer's rule - including non-ASCII, so a Chinese
 * variable name completes like any other. Kept in step with `isIdentifierPart` there: if the two
 * disagree, the fragment the menu replaces is not the fragment the parser reads.
 */
function isExpressionIdentifierChar(char: string): boolean {
    return /[A-Za-z0-9_$.]/.test(char) || char.charCodeAt(0) > 0x7f;
}

/**
 * The caret inside an expression: what fragment is being typed, and what a completion replaces.
 *
 * `expressionStart` bounds the scan so a completion can never reach back past the expression into the
 * command token or an earlier positional.
 */
function expressionCursor(param: StoryCommandParam, source: string, caret: number, expressionStart: number): StoryCommandCursor {
    let start = caret;
    while (start > expressionStart && isExpressionIdentifierChar(source[start - 1])) {
        start -= 1;
    }
    let end = caret;
    while (end < source.length && isExpressionIdentifierChar(source[end])) {
        end += 1;
    }
    return { kind: "expression", param, query: source.slice(start, caret), replace: { start, end } };
}

function characterCursor(source: string, caret: number): StoryCommandCursor {
    const boundary = source.indexOf(" ");
    const nameEnd = boundary === -1 ? source.length : boundary;
    if (caret > nameEnd) {
        // Past the name is the line of dialogue.
        return { kind: "greedy" };
    }
    return { kind: "characterName", query: source.slice(1, caret), replace: { start: 1, end: nameEnd } };
}

/**
 * Classify the caret. `/` and `#` are triggers only at the start of the line - mid-line they are
 * ordinary characters, or `他/她` would open a menu. The caller owns the "empty slot" half of that
 * rule (see `handleInsertValueChange`).
 */
export function getCommandCursor(source: string, caret: number): StoryCommandCursor {
    const at = Math.max(0, Math.min(caret, source.length));
    if (!source) {
        return { kind: "none" };
    }
    if (source.startsWith("/")) {
        return commandCursor(source, at);
    }
    if (source.startsWith("#")) {
        return characterCursor(source, at);
    }
    return { kind: "none" };
}

/**
 * The text to write and where, for taking a candidate.
 *
 * A param name completes to `key=` with **no** trailing space, so the value's candidates open
 * immediately - the two-stage Tab. Everything else completes to a whole token and a space, ready for
 * the next one. Values with spaces are quoted, or the tokenizer would split them back apart.
 */
export function completionFor(cursor: StoryCommandCursor, value: string): { text: string; replace: StoryCommandSpan } | null {
    switch (cursor.kind) {
        case "commandName":
            return { text: `${value} `, replace: cursor.replace };
        case "paramName":
            return { text: `${value}=`, replace: cursor.replace };
        case "positional":
        case "paramValue":
            return { text: `${value.includes(" ") ? `"${value}"` : value} `, replace: cursor.replace };
        case "characterName":
            return { text: `${value} `, replace: cursor.replace };
        case "expression":
            // No trailing space, and never quoted: this replaces one identifier inside a larger
            // expression. `min(` completes to `min(` with the caret ready for its arguments, and a
            // variable name completes to just the name so `gold` can be followed by `+ 1`.
            return { text: value, replace: cursor.replace };
        case "greedy":
        case "none":
            return null;
    }
}
