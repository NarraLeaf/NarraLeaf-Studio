/**
 * The `.story` line shapes: the markers, the escaping, and the rule that decides what a line is.
 *
 * ## What this format is for
 *
 * Driving `project/app/story.js`. Studio gives an author no text-based way to write a story, and
 * nothing here is reachable from its interface - a `.story` file is a tool artefact that lives in
 * the checkout's scratch directory for as long as one edit takes. The author-facing `.txt` script
 * export (`lib/story/script/`) is a different, narrower thing: it makes prose editable outside
 * Studio and projects everything else to a label it will never read back. This one has to be able to
 * write any row, so it is a superset in coverage and a tool format in audience, and the two do not
 * share a codec.
 *
 * ## Every line is one of eight shapes
 *
 * The shape comes from the first characters after the indentation, and nothing else - there is no
 * lookahead and no context. Which means an author's prose can never *become* a command by accident,
 * and equally that prose which would open with a marker has to escape it. The markers are the ones
 * the `.txt` codec already reserves, so the two formats agree about which characters are structural.
 *
 * ## The anchor is the row's identity
 *
 * A trailing `⟦…⟧` carries the block id (its first 8 characters, or more where that is not unique in
 * the scene) and any flag the line's own shape cannot say. Identity has to be written down rather
 * than inferred from position, because a row's `textId` is what every translation of that line is
 * filed under and its block id is what a save anchor resolves against: rebinding rows by position
 * would silently unlink both, and nothing records what they were.
 *
 * Comments in English per project convention.
 */

/** Bumped when a change would make an older file read as something else. */
export const STORY_FILE_FORMAT_VERSION = 1 as const;

export const DIRECTIVE_FORMAT = "#nlstory";
export const DIRECTIVE_STORY = "#story";
export const DIRECTIVE_SCENE = "#scene";
export const DIRECTIVE_DATA = "#data";

/** Two spaces per nesting level. The tree is rebuilt from this on read. */
export const INDENT_UNIT = "  ";

export const ANCHOR_OPEN = "⟦";
export const ANCHOR_CLOSE = "⟧";

export const NOTE_PREFIX = "// ";
export const OPTION_PREFIX = "- ";
export const BRANCH_PREFIX = "? ";
export const OPAQUE_PREFIX = "» ";
export const COMMAND_PREFIX = "/";
/** A row that holds nothing. A blank line in the file is spacing and means no row at all. */
export const EMPTY_ROW = ".";
/** The word an `else` branch carries where the other branches carry an expression. */
export const BRANCH_ELSE = "else";

/** The flag an anchor may carry beside the id, for the one row state no shape can express. */
export const FLAG_DISABLED = "disabled";

export type StoryLineShape =
    | "command"
    | "dialogue"
    | "narration"
    | "note"
    | "option"
    | "branch"
    | "opaque"
    | "empty";

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/**
 * Characters and openings that must never reach the reader as themselves.
 *
 * Escaping only the marker characters is not enough, and each of these was a way a zero-edit round
 * trip could change what a line said:
 *
 *  - `\` itself, or an escape could not be written literally.
 *  - The anchor brackets, or prose containing one would end the line early.
 *  - `: ` anywhere in a narration line, or `he said: hello` reads back as dialogue by "he said".
 *  - A leading marker (`/`, `#`, `//`, `- `, `? `, `» `, `.`), or prose becomes a row of another kind.
 *  - Leading and trailing spaces, since indentation is counted in spaces and the anchor is
 *    separated by exactly one.
 */
const ESCAPES: readonly (readonly [string, string])[] = [
    ["\\", "\\\\"],
    ["\n", "\\n"],
    ["\r", "\\r"],
    ["\t", "\\t"],
    [ANCHOR_OPEN, `\\${ANCHOR_OPEN}`],
    [ANCHOR_CLOSE, `\\${ANCHOR_CLOSE}`],
];

export function escapeText(text: string, options: { asProse: boolean }): string {
    let out = text;
    for (const [from, to] of ESCAPES) {
        out = out.split(from).join(to);
    }
    if (options.asProse) {
        // Only in prose: a command line's own `: ` is inside a value the command parser owns, and a
        // speaker label is matched before this ever runs.
        out = out.split(": ").join("\\: ");
    }
    // A leading marker, escaped once at the front - which is all it takes, because the shape rule
    // only ever looks at the start of the line.
    for (const marker of [NOTE_PREFIX, OPTION_PREFIX, BRANCH_PREFIX, OPAQUE_PREFIX, COMMAND_PREFIX, "#", EMPTY_ROW]) {
        if (out.startsWith(marker)) {
            out = `\\${out}`;
            break;
        }
    }
    if (out !== out.trim()) {
        // A space the reader would eat. Escaping the one at each end is enough: the middle of a line
        // is copied verbatim.
        out = out.replace(/^ /, "\\ ").replace(/ $/, "\\ ");
    }
    return out;
}

export function unescapeText(text: string): string {
    let out = "";
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] !== "\\") {
            out += text[i];
            continue;
        }
        const next = text[i + 1];
        if (next === undefined) {
            out += "\\";
            continue;
        }
        i += 1;
        out += next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** How deep a line sits, and the line with its indentation removed. */
export function splitIndent(line: string): { depth: number; body: string } {
    let spaces = 0;
    while (line[spaces] === " ") {
        spaces += 1;
    }
    return { depth: Math.floor(spaces / INDENT_UNIT.length), body: line.slice(spaces) };
}

/**
 * The trailing anchor, if the line carries one, and the line without it.
 *
 * Read from the END of the line rather than searched for, so an escaped bracket inside prose can
 * never be mistaken for one: the anchor is the last thing on the line or it is not an anchor.
 */
export function splitAnchor(body: string): { text: string; id: string | null; flags: readonly string[] } {
    const trimmed = body.trimEnd();
    if (!trimmed.endsWith(ANCHOR_CLOSE)) {
        return { text: body, id: null, flags: [] };
    }
    const open = trimmed.lastIndexOf(ANCHOR_OPEN);
    // An escaped bracket is not an opening. Counting the backslashes before it is what tells the two
    // apart, and an even count (none included) means the bracket is really there.
    if (open < 0 || isEscaped(trimmed, open)) {
        return { text: body, id: null, flags: [] };
    }
    const inside = trimmed.slice(open + ANCHOR_OPEN.length, trimmed.length - ANCHOR_CLOSE.length).trim();
    const tokens = inside.split(/\s+/).filter(Boolean);
    const id = tokens[0] && tokens[0] !== FLAG_DISABLED ? tokens[0] : null;
    const flags = tokens.filter(token => token !== id);
    return { text: trimmed.slice(0, open).trimEnd(), id, flags };
}

function isEscaped(text: string, index: number): boolean {
    let slashes = 0;
    for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
        slashes += 1;
    }
    return slashes % 2 === 1;
}

/**
 * What shape a line is, from its opening alone.
 *
 * A line that opens with `/` is a command even when no such command exists - it must NOT fall
 * through to narration, because a story silently turning a broken command into a line of prose is
 * the failure this whole rule exists to prevent. The unknown command is reported instead.
 */
export function shapeOf(text: string): StoryLineShape {
    if (text === EMPTY_ROW) {
        return "empty";
    }
    if (text.startsWith(NOTE_PREFIX) || text === NOTE_PREFIX.trimEnd()) {
        return "note";
    }
    if (text.startsWith(OPTION_PREFIX) || text === OPTION_PREFIX.trimEnd()) {
        return "option";
    }
    if (text.startsWith(BRANCH_PREFIX) || text === BRANCH_PREFIX.trimEnd()) {
        return "branch";
    }
    if (text.startsWith(OPAQUE_PREFIX)) {
        return "opaque";
    }
    if (text.startsWith(COMMAND_PREFIX)) {
        return "command";
    }
    return speakerSplit(text) ? "dialogue" : "narration";
}

/**
 * A dialogue line's speaker and words, or null when the line carries no unescaped `: `.
 *
 * The speaker is everything before the first unescaped separator. A name may therefore not contain
 * `: ` - which is what the escape in {@link escapeText} guarantees on the way out.
 */
export function speakerSplit(text: string): { speaker: string; words: string } | null {
    for (let i = 0; i + 1 < text.length; i += 1) {
        if (text[i] === ":" && text[i + 1] === " " && !isEscaped(text, i)) {
            return { speaker: text.slice(0, i), words: text.slice(i + 2) };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export const LINE_SHAPES_HELP = `A .story file is one scene. Two spaces per nesting level; the shape of a line comes
from what it starts with, and nothing else.

  /bg forest_day t=fade       a command - "story commands" lists them, "story command <token>"
                              explains one. A line opening with / is always a command: an
                              unknown one is an error, never prose.
  Alice: Good morning.        dialogue. Everything before the first ": " is the speaker; a name
                              no character answers to is a one-off speaker, exactly as /say does.
  The rain had stopped.       narration - any line that is none of the others.
  // check this line          a note. Never compiled, never shown to a player.
  - I was waiting for you.    a choice option. Only under a /menu row.
  ? gold > 10                 a branch of the /if above it. "? else" is the else branch.
  » Story Motion: sway        a row this format cannot spell. Kept verbatim from #data below,
                              and NEVER read back from the label - edit it in Studio instead.
  .                           a blank row. A blank LINE is spacing and means no row at all.

Each line may end with an anchor naming the row it is:

  Alice: Good morning.        ⟦4f2a91c0⟧
  Alice: Not this one.        ⟦4f2a91c0 disabled⟧

The id is what keeps a row's identity - and with it every translation of the line, which is
filed under the row rather than under its text. A line with no anchor is a new row. Delete a
line and the row goes with it: a file describes the WHOLE scene.

Escaping: a backslash before a leading marker, a ": " inside narration, an anchor bracket, or a
space at either end. "story show" writes these for you.

The header is three directives; the footer is the verbatim payloads the » lines stand for:

  #nlstory ${STORY_FILE_FORMAT_VERSION}
  #story  Chapter one
  #scene  Classroom, after school  ⟦3d90de56-429e-497c-8cde-96c92b7ae11f⟧
  ...
  #data
  {"7c1f4b02":{"kind":"action","payload":{...}}}`;
