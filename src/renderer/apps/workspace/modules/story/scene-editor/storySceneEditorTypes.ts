import type { StoryBlock, StoryBlockId, StoryRichRun } from "@shared/types/story";

export type StoryBlockTarget = {
    parentId: StoryBlockId | null;
    beforeBlockId?: StoryBlockId | null;
};

export type VisibleStoryRow = {
    block: StoryBlock;
    depth: number;
    lineNumber: number;
};

export type InsertSlot = {
    afterBlockId: StoryBlockId | null;
    focusToken: number;
    /**
     * Explicit insertion target. When set, the created block is parented here (used by the "add inside
     * a container" affordances) instead of being placed as a sibling after `afterBlockId`.
     */
    target?: StoryBlockTarget;
};

/**
 * Where the caret lands when a row opens for editing. `"start"` / `"end"` are the plain edge
 * landings; the explicit unit range carries a selection the author already made in the read-only row
 * (drag- or double-click-select) into the editor, so the gesture that opened the row is not thrown
 * away.
 *
 * `goalX` is the vertical-arrow landing: the caret's own x carried over from the row the author left,
 * to be resolved against this row's text on the `line` they are arriving at (`"first"` coming down,
 * `"last"` coming up). Rows are separate editors, so the goal column has to cross the boundary as
 * data — the browser only maintains one within a single field.
 */
export type StoryCaretTarget =
    | "start"
    | "end"
    | { start: number; end: number }
    | { goalX: number; line: "first" | "last" };

export type EditorMode =
    | { kind: "idle" }
    | { kind: "text"; blockId: StoryBlockId; value: string; rich?: StoryRichRun[]; caret?: StoryCaretTarget }
    /**
     * `chooserDismissed` survives until the slot is left: Escape closing the candidates is a
     * statement about this line ("I know what I'm typing"), so the menu must not reappear on the
     * next keystroke — which it would, since the chooser is otherwise derived from `value`'s prefix.
     */
    | { kind: "insert"; slot: InsertSlot; value: string; chooser: "none" | "action" | "character"; chooserDismissed?: boolean }
    | { kind: "inspector"; blockId: StoryBlockId };

export type SerializedStoryBlock = {
    block: StoryBlock;
    children: SerializedStoryBlock[];
};

export type StoryClipboardPayload = {
    version: 1;
    kind: "narraleaf.story.actions";
    roots: SerializedStoryBlock[];
};
