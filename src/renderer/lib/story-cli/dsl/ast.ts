/**
 * What a `.story` file is, once read: a header, a flat list of lines that know how deep they sit,
 * and the verbatim payloads the opaque lines stand for.
 *
 * Flat rather than a tree, because indentation can be wrong - a line two levels deeper than its
 * predecessor, or a child of a row that takes no children - and a parser that built a tree would
 * have to invent a shape for those before it could report them. The tree is assembled in
 * `compile.ts`, where the rules about which rows accept children live.
 *
 * Comments in English per project convention.
 */

import type { StoryBlock } from "@shared/types/story";
import type { StoryLineShape } from "./shapes";

export type StoryFileLine = {
    /** 1-based, as an editor counts them: every diagnostic anchors here. */
    lineNumber: number;
    /** Indentation depth in units of two spaces. */
    depth: number;
    shape: StoryLineShape;
    /**
     * The line's content with its shape marker and anchor removed, still escaped.
     *
     * Escaped rather than decoded, because the printer compares what it would write against what
     * the file holds, and that comparison has to be on one representation. Decoding happens where a
     * value is built.
     */
    text: string;
    /** The id from the anchor - a prefix of a block id, or a whole one. Null on a new line. */
    anchorId: string | null;
    disabled: boolean;
};

export type StoryFileAst = {
    formatVersion: number;
    storyName: string | null;
    sceneName: string | null;
    /** From the scene directive's anchor. Null when the file names the scene only by name. */
    sceneId: string | null;
    lines: StoryFileLine[];
    /** Anchor id to the block it stands for, from the `#data` footer. */
    data: Record<string, StoryBlock>;
};

export type StoryFileSeverity = "error" | "warning";

export type StoryFileDiagnostic = {
    /** Dotted, and stable: the first segment says which pass found it. */
    code: string;
    severity: StoryFileSeverity;
    message: string;
    /** 1-based line, where the finding belongs to one. */
    line?: number;
};

export function errorAt(code: string, message: string, line?: number): StoryFileDiagnostic {
    return { code, severity: "error", message, ...(line === undefined ? {} : { line }) };
}

export function warningAt(code: string, message: string, line?: number): StoryFileDiagnostic {
    return { code, severity: "warning", message, ...(line === undefined ? {} : { line }) };
}
