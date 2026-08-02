import { paramTypes, type StoryCommandParam } from "./storyCommandGrammar";
import { parseCommandLine, type StoryCommandSpan } from "./storyCommandParser";

/**
 * What each stretch of a command line *is*, so a surface can colour it by role.
 *
 * One colour per role, never a rainbow cycling through the tokens: the eye has to be able to answer
 * "which word is the verb" without reading, and that only works if the verb's colour means "verb"
 * everywhere it appears. Four roles is the whole vocabulary — three that speak and one that gets out
 * of the way.
 *
 * Deliberately span-based rather than token-based. The parser already records every span it needs
 * (`tokenSpan`, `keySpan`, `valueSpan`, every issue's span) and nothing consumed them for rendering
 * until now; a second tokenizer here would be the fourth copy of the same splitting logic and would
 * drift from the parse the author is actually being judged against.
 *
 * Pure, so it can be tested without mounting anything, and so both the live field and the committed
 * row can share one answer. That sharing is the point of the whole exercise: a line has to read as
 * the same sentence before and after Enter, or the row looks like a translation of what was typed
 * rather than the thing itself.
 */

export type StoryCommandRole =
    /** The command word. The anchor — the eye should land here first. */
    | "verb"
    /** The thing being acted on: a character, a stage object, a scene, a variable. */
    | "target"
    /** A value: an enum word, a number, a colour, a quoted string. Same role whether `fade` or `1`. */
    | "value"
    /**
     * Everything holding the sentence together: the trigger, the binders, the param keys, the units.
     * Muted, and the param keys most of all — a Chinese key (`转场`, `秒数`) is two full-width glyphs
     * and will out-shout the value it introduces if it keeps a colour of its own.
     */
    | "scaffold";

export type StoryCommandHighlight = {
    span: StoryCommandSpan;
    role: StoryCommandRole;
};

/**
 * Param types that name a thing rather than describe one. A slot typed like this holds the sentence's
 * object — a character, an asset, a scene, a track, a variable, a label.
 *
 * Decided by TYPE, not by the param's name: `/hide` calls its slot `target` but `/bg` calls its slot
 * `image`, and both are the thing the verb acts on. Name-matching got `/bg forest` wrong and would
 * have gone on being wrong for every command that names its object after what it is.
 */
const ENTITY_KINDS: ReadonlySet<string> = new Set([
    "asset", "character", "scene", "audioTrack", "variable", "label", "target",
]);

/**
 * Whether a positional reads as the thing acted on rather than as a value given to it.
 *
 * Only positionals ever qualify (bible B1: an existing object is always addressed positionally, and a
 * `k=v` is always a modifier), and only when the slot names an entity — so `/wait 5` and `/vol 0.5`
 * lead with a value, which is what they are, while `/jump 'Scene Name'` leads with its object.
 */
function isTargetParam(param: StoryCommandParam | null): boolean {
    return param !== null && paramTypes(param).some(type => ENTITY_KINDS.has(type.kind));
}

/**
 * The roles of a command line, in source order and non-overlapping.
 *
 * Anything not covered is scaffold by omission — the caller paints the gaps muted, which is exactly
 * the right default: an unrecognized stretch of a half-typed line should recede, not light up.
 *
 * `source` is the CANONICAL line (a leading "@" already folded to "/"), the same text the parser and
 * the cursor see, so the spans line up with what the author has on screen character for character.
 */
export function getCommandHighlights(source: string): readonly StoryCommandHighlight[] {
    const line = parseCommandLine(source);
    if (line.kind !== "command") {
        return [];
    }
    const highlights: StoryCommandHighlight[] = [];
    // The verb, even when it names no command: a word being typed is still the verb slot, and having
    // it go dark on every intermediate keystroke would make the line flicker as it is written.
    if (line.tokenSpan.end > line.tokenSpan.start) {
        highlights.push({ span: line.tokenSpan, role: "verb" });
    }
    for (const arg of line.args) {
        // The key and its binder stay scaffold — omitted, so they inherit the muted default.
        if (arg.valueSpan.end <= arg.valueSpan.start) {
            continue;
        }
        const isPositional = arg.key === null;
        const role: StoryCommandRole = isPositional && isTargetParam(arg.param) ? "target" : "value";
        highlights.push({ span: arg.valueSpan, role });
    }
    return highlights.sort((a, b) => a.span.start - b.span.start);
}

/** One stretch of the rendered line: the text, and the role that colours it. */
export type StoryCommandSegment = {
    text: string;
    role: StoryCommandRole;
};

/**
 * The whole line as consecutive segments, gaps filled with scaffold — what a renderer walks.
 *
 * Returns segments covering `source` exactly, so joining their text reproduces it. That is worth
 * stating as a guarantee: the overlay this feeds sits on top of a textarea and has to occupy the same
 * width, character for character, or the caret and the colours drift apart as the line grows.
 */
export function getCommandSegments(source: string): readonly StoryCommandSegment[] {
    const segments: StoryCommandSegment[] = [];
    let at = 0;
    const push = (text: string, role: StoryCommandRole) => {
        if (text !== "") {
            segments.push({ text, role });
        }
    };
    for (const highlight of getCommandHighlights(source)) {
        if (highlight.span.start < at) {
            continue;
        }
        push(source.slice(at, highlight.span.start), "scaffold");
        push(source.slice(highlight.span.start, highlight.span.end), highlight.role);
        at = highlight.span.end;
    }
    push(source.slice(at), "scaffold");
    return segments;
}
