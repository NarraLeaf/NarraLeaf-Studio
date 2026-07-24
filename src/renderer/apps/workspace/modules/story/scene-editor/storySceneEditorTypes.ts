import type { StoryBlock, StoryBlockId, StoryCharacterVariantSelection, StoryRichRun } from "@shared/types/story";

export type StoryBlockTarget = {
    parentId: StoryBlockId | null;
    beforeBlockId?: StoryBlockId | null;
};

/** The three stage placements `at=` accepts (bible §1.2). */
export type StoryStagePlacement = "left" | "center" | "right";

/** The form + variants a character is showing at a given point — its "current appearance". */
export type CharacterAppearanceRef = {
    formName?: string;
    variants?: StoryCharacterVariantSelection;
    /**
     * Whether the character was actually shown (an enter/expression), as opposed to only positioned by
     * a move on a character that was never shown. Only a shown character pictures an avatar; a
     * position-only appearance exists purely so the group-header dropdown can read/edit its placement.
     */
    shown?: boolean;
    /**
     * The character's placement (`at=`) at this point, accumulated from its most recent enter/move
     * (WI-3, M3.1). Drives the group-header position dropdown's current value; absent means the
     * placement was never set explicitly, so it reads as the runtime default (center).
     */
    position?: StoryStagePlacement;
    /**
     * The block id of that most-recent enter/move — the row whose `at=` the group-header dropdown
     * rewrites in place. Absent when the character has no enter/move yet (the dropdown inserts a
     * `/move` above the group head instead).
     */
    positionSourceId?: StoryBlockId;
};

export type VisibleStoryRow = {
    block: StoryBlock;
    depth: number;
    lineNumber: number;
    /**
     * For a dialogue row, the speaker's accumulated appearance at this line (WI-3), so its avatar can
     * follow the most recent enter/expression. Absent on non-dialogue rows and when nothing was shown.
     */
    appearance?: CharacterAppearanceRef;
    /**
     * Dialogue-grouping role (WI-5), a pure render projection. `"head"` is the first dialogue of a
     * run of same-speaker lines (renders avatar + nametag as usual); `"member"` is a continuation —
     * a later same-speaker dialogue, or a same-character expression line — which drops the badge and
     * nametag for a group rail. Absent on rows that are not part of any dialogue group.
     */
    groupRole?: "head" | "member";
    /**
     * The row is compiled out (WI-3 / schema v7): disabled itself or nested in a disabled container.
     * Rendered muted at reduced opacity; the runtime behaves as if it were not there.
     */
    disabled?: boolean;
};

export type InsertSlot = {
    afterBlockId: StoryBlockId | null;
    focusToken: number;
    /**
     * Explicit insertion target. When set, the created block is parented here (used by the "add inside
     * a container" affordances) instead of being placed as a sibling after `afterBlockId`.
     */
    target?: StoryBlockTarget;
    /**
     * The block this slot is *rewriting* rather than inserting after — set when re-opening an invalid
     * row for editing. On commit the new block takes its place and this one is removed; on Escape
     * nothing happens and the row survives untouched, which is why the original is not deleted up
     * front. Its text seeds the slot's `value`.
     */
    replaceBlockId?: StoryBlockId;
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
 * data - the browser only maintains one within a single field.
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
     * The candidate menu the slot shows is derived from `value` (see `insertChooserType`), never stored -
     * a stored copy drifted, and a reopened draft row inherited a stale "none" that killed its completion.
     * `chooserDismissed` is the one thing text cannot express: Escape closing the candidates is a
     * statement about this line ("I know what I'm typing"). It is one-shot - the next keystroke clears it
     * (see `handleInsertValueChange`), so the menu comes back the moment the author edits, rather than
     * staying shut for the slot's whole life.
     *
     * `confirmation` is the just-declared line's ghost receipt (`✓ Var gold: number = 0`, bible §3.5),
     * carried on the fresh slot that opens after a declaration commits. Like `chooserDismissed` it is
     * one-shot — the next edit strips it (see `handleInsertValueChange`) — and it lives on the slot, not
     * in separate state, so navigating to any other slot leaves it behind without anyone clearing it.
     */
    | { kind: "insert"; slot: InsertSlot; value: string; chooserDismissed?: boolean; confirmation?: string }
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
