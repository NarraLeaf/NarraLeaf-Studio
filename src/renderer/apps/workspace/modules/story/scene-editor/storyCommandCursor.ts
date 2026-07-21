import { findParam, isFlagParam, paramTypes, positionalParams, type StoryCommandDef, type StoryCommandParam } from "./storyCommandGrammar";
import { getCommandDef } from "./commands/registry";
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
 *
 * `candidates` refines "must-pick" with what the slot is actually offering, which the cursor alone
 * cannot know. Two positions look like value slots but have to let Enter submit:
 *
 *  - **Nothing typed yet.** `/var gold ` sits in an optional default whose only suggestions are
 *    `true`/`false`. Highlighting one means Enter declares a boolean the author never asked for, and
 *    leaves no key that means "I am done". An empty query is not a half-finished pick; it is a slot
 *    being skipped, and skipping optional params is the common case.
 *  - **The top candidate is the author's own text echoed back** (`free`). `/say Zoe` offers "Zoe" as
 *    a temp speaker; taking it and submitting the line build the same block, so Enter should submit.
 *    A *real* match still wins - `/say Ali` puts Alice first, not a free echo, so Enter picks Alice.
 *
 * Tab is unaffected: it takes the first candidate whether or not it was highlighted, so completing
 * `/var gold tr` to `true` still costs one key.
 */
export function defaultHighlights(cursor: StoryCommandCursor, candidates: readonly { free?: true; value?: string }[] = []): boolean {
    switch (cursor.kind) {
        case "positional":
        case "paramValue": {
            const query = cursor.query.trim();
            if (query === "" || candidates.length === 0) {
                return false;
            }
            if (candidates[0].free) {
                return false;
            }
            // The author already typed the whole answer: taking the candidate would change nothing,
            // so Enter must mean submit. Without this, `/var met true` needed a second Enter - the
            // first one "completed" `true` to `true` and the line looked like a dead keypress.
            // Same rationale as the free echo above: take-and-submit build the same block.
            return candidates[0].value?.trim().toLowerCase() !== query.toLowerCase();
        }
        case "commandName":
        case "characterName":
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

/** Index of the first `=` outside quotes of either kind, or -1. Mirrors the parser's own splitting. */
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

/** Remove the structural quotes of either kind, keeping the other kind's characters as data. Mirrors the parser. */
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

/** Positional params already satisfied by tokens strictly before the caret's own token. A bare flag (`loop`) is a named arg, not a positional. */
function positionalIndexBefore(def: StoryCommandDef, tokens: readonly StoryCommandToken[], activeStart: number): number {
    let index = 0;
    for (const token of tokens.slice(1)) {
        if (token.span.start >= activeStart) {
            break;
        }
        if (firstUnquotedEquals(token.raw) > 0) {
            continue;
        }
        const flag = findParam(def, token.text);
        if (flag && isFlagParam(flag) && index > 0) {
            continue;
        }
        index += 1;
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
            const param = findParam(def, active.raw.slice(0, equals));
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
    const index = positionalIndexBefore(def, tokens, activeStart);

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
 * The opening `'` of the single-quoted entity name the caret sits inside, or -1.
 *
 * Walks the expression's quote state from its start, so an apostrophe inside a double-quoted string
 * (`"don't"`) does not read as an opening quote. Mirrors the expression tokenizer: `\` escapes inside
 * a string, nothing escapes inside a quoted name.
 */
function quotedNameStart(source: string, caret: number, expressionStart: number): number {
    let openedAt = -1;
    let inString = false;
    for (let index = expressionStart; index < caret && index < source.length; index += 1) {
        const char = source[index];
        if (inString) {
            if (char === "\\") {
                index += 1;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }
        if (openedAt >= 0) {
            if (char === "'") {
                openedAt = -1;
            }
            continue;
        }
        if (char === "\"") {
            inString = true;
        } else if (char === "'") {
            openedAt = index;
        }
    }
    return openedAt;
}

/**
 * The caret inside an expression: what fragment is being typed, and what a completion replaces.
 *
 * `expressionStart` bounds the scan so a completion can never reach back past the expression into the
 * command token or an earlier positional.
 *
 * Inside a single-quoted entity name the identifier-character scan would stop at the nearest space
 * and offer to replace one word of a multi-word name. So the quoted region wins: the query is the
 * quoted content up to the caret, and the replacement spans the whole region, quotes included -
 * through the closing `'` when it exists, to the end of the line when it does not (an unterminated
 * quote owns everything after it, lexically, so replacing that much is consistent with what the
 * parser would read). A completion then re-quotes as needed, never nests inside the old quotes.
 */
function expressionCursor(param: StoryCommandParam, source: string, caret: number, expressionStart: number): StoryCommandCursor {
    const openedAt = quotedNameStart(source, caret, expressionStart);
    if (openedAt >= 0) {
        let end = caret;
        while (end < source.length && source[end] !== "'") {
            end += 1;
        }
        if (end < source.length) {
            end += 1; // take the closing quote too
        }
        return { kind: "expression", param, query: source.slice(openedAt + 1, caret), replace: { start: openedAt, end } };
    }

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
 * A completed value made safe for the tokenizer: single-quoted when it contains a space, since what
 * the menu completes is always an entity name or an enum word, never a string literal - `'…'` is the
 * entity-reference spelling. A name that itself contains a `'` falls back to double quotes (there is
 * no escape syntax); resolution reads entity slots leniently under either kind.
 */
function quoteEntityValue(value: string): string {
    if (!value.includes(" ")) {
        return value;
    }
    return value.includes("'") ? `"${value}"` : `'${value}'`;
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
            return { text: `${quoteEntityValue(value)} `, replace: cursor.replace };
        case "characterName":
            return { text: `${value} `, replace: cursor.replace };
        case "expression":
            // No trailing space: this replaces one identifier inside a larger expression. `min(`
            // completes to `min(` with the caret ready for its arguments, and a variable name
            // completes to just the name so `gold` can be followed by `+ 1`. A name with a space is
            // single-quoted - the expression language's quoted-identifier spelling - or the lexer
            // would read it back as two names. The replace span already covers any quotes the author
            // opened (see expressionCursor), so this never nests quotes.
            return { text: value.includes(" ") ? `'${value}'` : value, replace: cursor.replace };
        case "greedy":
        case "none":
            return null;
    }
}
