import type { StoryBlock, StoryBlockId, StoryScene, StorySceneId } from "@shared/types/story";
import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import type { NarralangParseDiagnostic } from "@/lib/story/narralang/narralangReconcile";

/**
 * The decisions the editable script view makes that are not about Monaco, so they can be read and
 * tested without one.
 *
 * Three of them, and each is a way of losing an author's work if it is got wrong: when a buffer is
 * written back to the document, when a change from elsewhere may replace what is on screen, and what
 * a line that does not parse is allowed to do (nothing).
 */

/**
 * How long the buffer sits still before it is written to the document.
 *
 * Per keystroke is out of the question - a commit re-parses the scene, rewrites the document and
 * republishes it to every panel. Idle is the shape that fits how the surface is used: an author types
 * a line, stops, and the line lands. Long enough to sit through a word, short enough that the row
 * list beside it is never far behind.
 */
export const NARRALANG_COMMIT_DEBOUNCE_MS = 500;

/**
 * How long two commits stay one undo step.
 *
 * `HistoryService` merges two checkpoints that carry the same key within this window, keeping the
 * older "before" - so a run of debounced commits collapses into the single step the author means by
 * "undo what I just typed". Without it every idle pause would be its own entry and undoing a
 * paragraph would take a press per pause, which is the failure the row editor does not have because
 * it commits once per row rather than once per pause.
 *
 * Measured between commits, not between keystrokes, so it has to be comfortably wider than
 * {@link NARRALANG_COMMIT_DEBOUNCE_MS}: typing continuously produces one commit every debounce, and
 * anything narrower would break the group in the middle of a sentence. A pause longer than this ends
 * the group, which is what makes undo granular enough to be useful at all.
 */
export const NARRALANG_HISTORY_MERGE_WINDOW_MS = 2500;

/**
 * The merge group a scene's script commits belong to.
 *
 * Per scene, so two scenes open at once cannot fold into each other's undo steps, and distinct from
 * anything the row editor pushes (it passes no key at all) so a row edit always ends the group.
 */
export function narralangHistoryMergeKey(sceneId: StorySceneId): string {
    return `narralang:${sceneId}`;
}

// --- Whether anything actually happened ---------------------------------------------------------------

/** As much of a reconcile as deciding "is this worth committing" needs. */
export type NarralangReconciledTree = {
    readonly rootBlockIds: readonly StoryBlockId[];
    readonly blocks: Readonly<Record<StoryBlockId, StoryBlock>>;
    readonly touchedBlockIds: readonly StoryBlockId[];
};

/**
 * Whether a reconciled tree says anything the scene does not.
 *
 * **`touchedBlockIds` alone is the wrong test, and getting this wrong looks like a broken editor.**
 * That array holds the blocks whose *content* changed - written afresh, or rewritten. A passage
 * dragged to another part of the scene, or a few lines re-indented into an `if`, changes no payload
 * at all: every block comes back byte-identical and the array comes back empty. Committing only on a
 * non-empty `touchedBlockIds` would mean an author could re-indent a block all day and watch nothing
 * happen.
 *
 * So the structure is compared too, and the structure is exactly `rootBlockIds` plus every block's
 * `childrenIds` - between them they say who is where, which is the whole of what a move changes.
 * (`parentId` is the same fact stated from the other end, so comparing it as well would only find the
 * inconsistencies a reconciler must not produce in the first place.)
 */
export function narralangSceneMoved(
    scene: Pick<StoryScene, "rootBlockIds" | "blocks">,
    next: NarralangReconciledTree,
): boolean {
    if (next.touchedBlockIds.length > 0) {
        return true;
    }
    if (!sameOrder(scene.rootBlockIds, next.rootBlockIds)) {
        return true;
    }
    const nextIds = Object.keys(next.blocks);
    // A row deleted or added with no payload of its own to touch - a container emptied, say - shows
    // up here and nowhere else.
    if (nextIds.length !== Object.keys(scene.blocks).length) {
        return true;
    }
    for (const blockId of nextIds) {
        const before = scene.blocks[blockId];
        if (!before || !sameOrder(before.childrenIds, next.blocks[blockId].childrenIds)) {
            return true;
        }
    }
    return false;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

// --- Diagnostics ------------------------------------------------------------------------------------

/**
 * The detail nouns a parse diagnostic may carry that are safe to show.
 *
 * A diagnostic's `detail` is whatever the builder that refused the line had to hand, and for some
 * reasons that is an internal verb name rather than a noun a reader knows. So the set is closed here
 * and anything outside it is dropped: the sentence without the noun is still true, and a line reading
 * "displayableShow" is not.
 */
export const NARRALANG_DIAGNOSTIC_NOUNS = [
    "appearance",
    "asset",
    "character",
    "displayable",
    "layer",
    "motion",
    "scene",
    "variable",
] as const;

export type NarralangDiagnosticNoun = typeof NARRALANG_DIAGNOSTIC_NOUNS[number];

const NOUNS: ReadonlySet<string> = new Set(NARRALANG_DIAGNOSTIC_NOUNS);

/** Where a diagnostic goes and what it says, in an editor's coordinates and nobody's vocabulary. */
export type NarralangDiagnosticMark = {
    /** 1-based, as the parser reports it and as Monaco takes it. */
    readonly line: number;
    readonly startColumn: number;
    /** End of the line: a parse failure is about the statement, not about one character of it. */
    readonly endColumn: number;
    readonly message: string;
};

/**
 * Diagnostics as marks against lines.
 *
 * Underlining the whole statement rather than one column, because a diagnostic here says the line
 * does not read as anything - "this word is wrong" would be a claim the parser did not make. The
 * reported column is kept as the start so the squiggle still begins where the reading broke down.
 */
export function narralangDiagnosticMarks(
    diagnostics: readonly NarralangParseDiagnostic[],
    lineLength: (line: number) => number,
    translate: (key: TranslationKey, params?: InterpolationParams) => string,
): NarralangDiagnosticMark[] {
    return diagnostics.map(diagnostic => {
        const noun = diagnostic.detail !== undefined && NOUNS.has(diagnostic.detail) ? diagnostic.detail : null;
        const named = noun !== null && (diagnostic.reason === "unknownName" || diagnostic.reason === "ambiguousName");
        const message = named
            ? translate(`story.narralang.parse.${diagnostic.reason}Named` as TranslationKey, {
                what: translate(`story.narralang.detail.${noun}` as TranslationKey),
            })
            : translate(`story.narralang.parse.${diagnostic.reason}` as TranslationKey);
        const start = Math.max(1, diagnostic.column);
        return {
            line: diagnostic.line,
            startColumn: start,
            endColumn: Math.max(start + 1, lineLength(diagnostic.line) + 1),
            message,
        };
    });
}

// --- Changes that arrive from elsewhere ---------------------------------------------------------------

export type NarralangBufferState = {
    /** The last text this view is responsible for: a print it adopted, or a buffer it committed. */
    readonly settled: string;
    /** What the model holds right now. */
    readonly buffer: string;
    /** Whether the author is inside the editor. */
    readonly focused: boolean;
};

/**
 * Whether a fresh print may replace what is on screen.
 *
 * The document can move while this view is open - another panel, an undo, a restored revision - and
 * the buffer is the only copy of anything the author has typed and not yet committed. So the answer
 * is no unless all three hold:
 *
 *  - the print says something the buffer does not, or there is nothing to do;
 *  - the buffer is exactly what this view last put there, so nothing typed is at stake;
 *  - the author is not in the editor, because even a replacement of equal text moves the caret, and
 *    a caret that jumps mid-sentence is indistinguishable from a bug.
 *
 * A print refused while focused is not lost - the caller holds it and asks again on blur, which is
 * why this is a predicate over state rather than a decision made once when the print arrives.
 */
export function shouldAdoptNarralangPrint(state: NarralangBufferState, incoming: string): boolean {
    if (incoming === state.buffer) {
        return false;
    }
    if (state.buffer !== state.settled) {
        return false;
    }
    return !state.focused;
}
