import { paramTypes, positionalParams, type StoryCommandParam } from "./storyCommandGrammar";
import { parseCommandLine, tokenizeCommandLine, unfilledParams, type StoryCommandLine } from "./storyCommandParser";

/**
 * The inline ghost hint: the grey `<Var Name>` that trails what the author has typed.
 *
 * The command line is discoverable in one direction only — the candidate menu tells you what values
 * fit the slot you are in, but nothing tells you that a slot is *there*. `/local` followed by a space
 * was a blank line with an empty menu: the author had to already know a variable name comes next.
 * This closes that, and it is the reason the parameter order stopped mattering as much — a slot that
 * names itself does not need to be memorized.
 *
 * Pure, and returns a *key* rather than a string: the grammar carries no locale data (see the note at
 * the top of `storyCommandGrammar`), so the caller resolves `story.paramHint.<key>` and decides how to
 * bracket it. Which is also what lets a Chinese author see `<变量名>` while the token stays `/local`.
 *
 * Deliberately narrow about when it appears. It is decoration over a text field, so any doubt about
 * where the caret is resolves to showing nothing:
 *  - only at the very end of the line (the ghost renders *after* the text; mid-line it would lie)
 *  - only after a completed token — that is, after a space, never mid-word, where it would fight the
 *    candidate menu for the same screen position and describe a slot the author is already filling
 *  - never once every slot is filled, and never on a line that does not parse as a command
 */

export type StoryCommandGhost = {
    /** Key under `story.paramHint.*`. */
    hintKey: string;
    /** The param this describes — callers may want its name for a tooltip or test. */
    param: StoryCommandParam;
};

/** The hint key a param answers to: its explicit `hint`, else its payload `name`. */
export function paramHintKey(param: StoryCommandParam): string {
    return param.hint ?? param.name;
}

/**
 * The next unfilled slot at the caret, or null when nothing should be shown.
 *
 * `caret` is required rather than assumed to be the end, because "the caret is at the end" is
 * precisely the condition being tested — a ghost drawn after the text while the author edits the
 * middle of the line would point at the wrong slot.
 */
export function getCommandGhost(source: string, caret: number): StoryCommandGhost | null {
    // Anywhere but the end of the line, the ghost would sit after text the author is not currently
    // extending, so it would describe a slot that is not the one being filled.
    if (caret !== source.length || !source.startsWith("/")) {
        return null;
    }
    // Mid-word: the author is typing a value, the candidate menu is already answering "what goes
    // here", and a ghost would render *inside* the token they are still writing.
    if (source.length > 1 && !source.endsWith(" ")) {
        return null;
    }

    const line = parseCommandLine(source);
    if (line.kind !== "command" || !line.def || line.issues.length > 0) {
        return null;
    }

    const next = nextSlot(line, source);
    return next ? { hintKey: paramHintKey(next), param: next } : null;
}

/**
 * Which param the next token would fill: the first unfilled positional, else the first unfilled
 * named param.
 *
 * Positionals come first because that is the order the parser fills them in — the ghost has to
 * predict the parser, not the grammar's declaration order. Named params are offered afterwards so a
 * finished line still advertises its modifiers (`/bg forest ` → `<transition>`) rather than going
 * blank the moment the required part is done.
 */
function nextSlot(line: Extract<StoryCommandLine, { kind: "command" }>, source: string): StoryCommandParam | null {
    const unfilled = unfilledParams(line);
    if (unfilled.length === 0) {
        return null;
    }

    // A greedy param that already has an arg has swallowed the rest of the line, so nothing follows
    // it — `/say alice hello ` must not advertise another slot.
    const filledGreedy = line.args.some(arg => arg.param?.greedy);
    if (filledGreedy) {
        return null;
    }

    const positionalsFilled = countFilledPositionals(line, source);
    const positionals = positionalParams(line.def!);
    const nextPositional = positionals[positionalsFilled];
    if (nextPositional && unfilled.includes(nextPositional)) {
        return nextPositional;
    }
    return unfilled.find(param => !param.positional) ?? null;
}

/**
 * How many positional slots the tokens so far have consumed.
 *
 * Counted off the raw tokens rather than off `line.args`, because a `key=value` token fills a named
 * param without advancing the positional counter, and an empty trailing token must not count at all.
 */
function countFilledPositionals(line: Extract<StoryCommandLine, { kind: "command" }>, source: string): number {
    const { tokens } = tokenizeCommandLine(source, 1);
    return tokens.slice(1).filter(token => token.text !== "" && firstUnquotedEquals(token.raw) <= 0).length;
}

/** Index of the first `=` outside quotes, or -1. Mirrors the parser's own splitting. */
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

/** Whether a param's slot accepts a computed expression — used to mark the hint as such in the UI. */
export function paramTakesExpression(param: StoryCommandParam): boolean {
    return paramTypes(param).some(type => type.kind === "expression");
}
