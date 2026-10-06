import { STORY_MARK_PX } from "../StoryRowGutterMark";
import {
    STORY_PREVIEW_PANE_MAX_FRACTION,
    STORY_PREVIEW_PANE_MIN_WIDTH,
} from "./storyScenePreviewSessionStore";

/**
 * How the docked live preview shares the scene editor's body with the script.
 *
 * The script is what the author is there to read, so it is the side that keeps its width: it never
 * goes below {@link storyScriptMinWidth}. The preview's stored width is a preference, honoured while
 * there is room for it beside that; when there is not, the preview gives way first, down to its own
 * minimum ({@link STORY_PREVIEW_PANE_MIN_WIDTH}, which still holds a usable 16:9 stage and the
 * header's two buttons). When even that does not fit beside the script, the preview moves under the
 * script instead of beside it (`stack`), full width, the way a narrow devtools panel moves its side
 * pane below. Nothing is written back in any of this: the stored width and mode are what the author
 * chose, and the preview returns to them by itself when the room comes back.
 */

/**
 * The shortest line the script column is set to, in ems of the story text.
 *
 * Twenty full-width characters, or about forty of Latin prose: a clause of dialogue on one line. A
 * narrower column breaks lines inside their phrases, and the script stops reading as sentences and
 * starts reading as a column of words - at the far end of which is a line broken after every second
 * character. Measured in ems so that it follows the editor's font size and density: a larger face
 * needs more room for the same line.
 */
export const STORY_SCRIPT_MIN_LINE_EM = 20;

/** The row list's scrollbar (`::-webkit-scrollbar` in styles.css), which the column reserves. */
const SCROLLBAR_PX = 8;
/** A row's left edge, the `border-l-2` its active and selected states paint. */
const ROW_EDGE_PX = 2;
/** The gap between a row's cells (`ROW_GAP_PX` in `StorySceneEditorRows`). */
const ROW_GAP_PX = 12;
/** The row's trailing padding (`pr-3`). */
const ROW_END_PAD_PX = 12;
/**
 * The row's own actions - insert after, delete, play from this row: three 24px buttons, 4px apart.
 * Always laid out and only shown on hover, so the words never re-wrap when the pointer arrives; that
 * makes them part of every row's width.
 */
const ROW_ACTIONS_PX = 3 * 24 + 2 * 4;

/**
 * The narrowest the script column may be: a narration row - the kind most of a scene is made of -
 * with {@link STORY_SCRIPT_MIN_LINE_EM} of words, and everything around them.
 *
 * Left to right: the scrollbar's reserve, the row's edge, the line-number gutter, the speaker mark
 * and its gap, the words, the gap to the problem mark's slot (empty at rest) and the gap after it,
 * the row's actions, and the trailing padding. With the default 14px face and a two-digit gutter
 * that is 202px of furniture and 280px of words. A paragraph's first line also carries its speaker's
 * name and one more action, so it gets fewer of the twenty; every line after it gets them all.
 */
export function storyScriptMinWidth(input: { fontSize: number; gutterWidth: number }): number {
    const furniture = SCROLLBAR_PX + ROW_EDGE_PX + input.gutterWidth + STORY_MARK_PX + ROW_GAP_PX
        + ROW_GAP_PX + ROW_GAP_PX + ROW_ACTIONS_PX + ROW_END_PAD_PX;
    return Math.ceil(furniture + STORY_SCRIPT_MIN_LINE_EM * input.fontSize);
}

/** The seam between the script and the docked preview: the resize handle's line. */
export const STORY_PREVIEW_DOCK_SEAM_PX = 2;

/**
 * The most of the editor body's height the preview takes when it sits under the script. Below the
 * script it takes its stage's natural height at the body's width, but the script keeps at least half.
 */
export const STORY_PREVIEW_STACK_MAX_FRACTION = 0.5;

export type StoryPreviewDockLayout =
    /** Beside the script, this wide; a drag may take it up to `maxPreviewWidth` and no further. */
    | { kind: "side"; previewWidth: number; maxPreviewWidth: number }
    /** Under the script, full width. */
    | { kind: "stack" };

/**
 * Whether the preview fits beside the script at all: the script at its minimum, the seam, and the
 * preview at its own. The stored width plays no part in it - only in how wide the preview is there.
 */
export function storyPreviewDockFitsBeside(bodyWidth: number, scriptMinWidth: number): boolean {
    return bodyWidth - STORY_PREVIEW_DOCK_SEAM_PX - scriptMinWidth >= STORY_PREVIEW_PANE_MIN_WIDTH;
}

/**
 * Where the docked preview goes in an editor body this wide, and how wide it is there.
 *
 * Beside the script it is the stored width, held to the room the script leaves (and to
 * {@link STORY_PREVIEW_PANE_MAX_FRACTION} of the body), never below its own minimum. The pane's style
 * says the same thing to the browser - a flex basis of the stored width, the two minimums, the
 * fraction as a maximum - so the column follows a window being resized without a render per frame;
 * this function is what decides between beside and under, and where a drag starts and stops.
 */
export function resolveStoryPreviewDockLayout(input: {
    bodyWidth: number;
    storedWidth: number;
    scriptMinWidth: number;
}): StoryPreviewDockLayout {
    if (!storyPreviewDockFitsBeside(input.bodyWidth, input.scriptMinWidth)) {
        return { kind: "stack" };
    }
    const room = input.bodyWidth - STORY_PREVIEW_DOCK_SEAM_PX - input.scriptMinWidth;
    const maxPreviewWidth = Math.max(
        STORY_PREVIEW_PANE_MIN_WIDTH,
        Math.min(room, input.bodyWidth * STORY_PREVIEW_PANE_MAX_FRACTION),
    );
    const previewWidth = Math.min(maxPreviewWidth, Math.max(STORY_PREVIEW_PANE_MIN_WIDTH, input.storedWidth));
    return { kind: "side", previewWidth, maxPreviewWidth };
}

/**
 * Where a drag of the docked preview's left edge lands: `delta` pixels to the right of where the
 * preview's width was `width`, held between its minimum and the room the script leaves. Dragging
 * toward the script stops when the script reaches its minimum.
 */
export function dragStoryPreviewDockWidth(width: number, delta: number, maxPreviewWidth: number): number {
    return Math.max(STORY_PREVIEW_PANE_MIN_WIDTH, Math.min(Math.floor(maxPreviewWidth), Math.round(width - delta)));
}
