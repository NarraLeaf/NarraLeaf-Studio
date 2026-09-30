/**
 * Text to {@link StoryFileAst}: the header, the line shapes, the indentation, and the footer.
 *
 * Nothing here knows what a command means or whether a name resolves. It answers one question per
 * line - what shape is this - and that answer comes from the line's opening alone, so a broken
 * command can never turn into narration and a piece of prose can never turn into a command. The
 * meaning of a line is `compile.ts`'s business.
 *
 * Comments in English per project convention.
 */

import type { StoryBlock } from "@shared/types/story";
import {
    errorAt,
    type StoryFileAst,
    type StoryFileDiagnostic,
    type StoryFileLine,
} from "./ast";
import {
    BRANCH_PREFIX,
    DIRECTIVE_DATA,
    DIRECTIVE_FORMAT,
    DIRECTIVE_SCENE,
    DIRECTIVE_STORY,
    FLAG_DISABLED,
    INDENT_UNIT,
    NOTE_PREFIX,
    OPAQUE_PREFIX,
    OPTION_PREFIX,
    shapeOf,
    splitAnchor,
    splitIndent,
    STORY_FILE_FORMAT_VERSION,
} from "./shapes";

export type StoryFileParse = {
    ast: StoryFileAst;
    diagnostics: StoryFileDiagnostic[];
};

export function parseStoryFile(source: string): StoryFileParse {
    const diagnostics: StoryFileDiagnostic[] = [];
    const ast: StoryFileAst = {
        formatVersion: STORY_FILE_FORMAT_VERSION,
        storyName: null,
        sceneName: null,
        sceneId: null,
        lines: [],
        data: {},
    };

    // Normalised on the way in: a file that has been through a Windows editor is not a different
    // file, and every marker test below would otherwise have to allow for a trailing return.
    const rawLines = source.replace(/\r\n?/g, "\n").split("\n");
    let inData = false;
    const dataLines: string[] = [];
    let sawFormat = false;

    for (let index = 0; index < rawLines.length; index += 1) {
        const lineNumber = index + 1;
        const raw = rawLines[index];
        if (inData) {
            dataLines.push(raw);
            continue;
        }
        if (raw.trim() === DIRECTIVE_DATA) {
            inData = true;
            continue;
        }
        // A blank line is spacing. The row that holds nothing is written `.`, so the file can be
        // laid out for reading without every gap becoming a row.
        if (raw.trim() === "") {
            continue;
        }
        const { depth, body } = splitIndent(raw);
        if (body.startsWith("#")) {
            sawFormat = readDirective(body, lineNumber, ast, diagnostics) || sawFormat;
            continue;
        }
        ast.lines.push(readLine(body, depth, lineNumber, diagnostics));
    }

    if (!sawFormat) {
        diagnostics.push(
            errorAt(
                "file.no_header",
                `No "${DIRECTIVE_FORMAT}" directive. A .story file opens with one; run "story show" to get a file that has it.`,
                1,
            ),
        );
    }
    if (dataLines.length > 0) {
        readData(dataLines.join("\n"), ast, diagnostics);
    }
    return { ast, diagnostics };
}

/** One header directive. Returns whether it was the format line, which the file must carry. */
function readDirective(
    body: string,
    lineNumber: number,
    ast: StoryFileAst,
    diagnostics: StoryFileDiagnostic[],
): boolean {
    const space = body.search(/\s/);
    const name = space < 0 ? body : body.slice(0, space);
    const rest = space < 0 ? "" : body.slice(space).trim();

    if (name === DIRECTIVE_FORMAT) {
        const version = Number(rest);
        if (!Number.isInteger(version) || version < 1) {
            diagnostics.push(errorAt("file.bad_version", `"${rest}" is not a format version.`, lineNumber));
            return true;
        }
        if (version > STORY_FILE_FORMAT_VERSION) {
            diagnostics.push(
                errorAt(
                    "file.future_version",
                    `This file says format ${version} and this build reads ${STORY_FILE_FORMAT_VERSION}. `
                        + "Something newer wrote it; reading it here would guess at what changed.",
                    lineNumber,
                ),
            );
        }
        ast.formatVersion = version;
        return true;
    }
    if (name === DIRECTIVE_STORY) {
        ast.storyName = stripAnchor(rest).text;
        return false;
    }
    if (name === DIRECTIVE_SCENE) {
        const { text, id } = stripAnchor(rest);
        ast.sceneName = text;
        ast.sceneId = id;
        return false;
    }
    // Every other `#` line is a comment. Deliberately silent: a file an agent has annotated should
    // not have to declare its annotations, and no directive this tool writes can be typed by
    // accident.
    return false;
}

function stripAnchor(text: string): { text: string; id: string | null } {
    const split = splitAnchor(text);
    return { text: split.text.trim(), id: split.id };
}

function readLine(
    body: string,
    depth: number,
    lineNumber: number,
    diagnostics: StoryFileDiagnostic[],
): StoryFileLine {
    const { text, id, flags } = splitAnchor(body);
    for (const flag of flags) {
        if (flag !== FLAG_DISABLED) {
            diagnostics.push(
                errorAt("file.unknown_flag", `"${flag}" is not a row flag. The only one is "${FLAG_DISABLED}".`, lineNumber),
            );
        }
    }
    const shape = shapeOf(text);
    return {
        lineNumber,
        depth,
        shape,
        // The marker is the shape's, not the content's, so it comes off here and the rest of the
        // tool never has to remember which shapes carry one.
        text: stripMarker(shape, text),
        anchorId: id,
        disabled: flags.includes(FLAG_DISABLED),
    };
}

function stripMarker(shape: StoryFileLine["shape"], text: string): string {
    switch (shape) {
        case "note":
            // The marker is `// ` with the space, but a note written down to nothing is just `//`,
            // so the shorter form is stripped when the longer one is not there.
            return text.startsWith(NOTE_PREFIX) ? text.slice(NOTE_PREFIX.length) : text.slice(NOTE_PREFIX.trimEnd().length);
        case "option":
            return text.slice(OPTION_PREFIX.length);
        case "branch":
            return text.slice(BRANCH_PREFIX.length);
        case "opaque":
            return text.slice(OPAQUE_PREFIX.length);
        case "empty":
            return "";
        default:
            // A command keeps its `/`, because that is what the command parser reads; prose and
            // dialogue never had a marker.
            return text;
    }
}

/**
 * The `#data` footer: anchor id to the block it stands for.
 *
 * A footer that will not parse is one error and no rows, rather than an error per opaque line: the
 * file has one snapshot and the whole of it is either readable or not.
 */
function readData(text: string, ast: StoryFileAst, diagnostics: StoryFileDiagnostic[]): void {
    const trimmed = text.trim();
    if (!trimmed) {
        return;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch (error) {
        diagnostics.push(
            errorAt("file.bad_data", `The #data footer is not JSON: ${(error as Error).message}`),
        );
        return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        diagnostics.push(errorAt("file.bad_data", "The #data footer must be an object keyed by anchor."));
        return;
    }
    ast.data = parsed as Record<string, StoryBlock>;
}

/** Indentation for a depth, so the printer and the reader count in the same unit. */
export function indentFor(depth: number): string {
    return INDENT_UNIT.repeat(Math.max(0, depth));
}
