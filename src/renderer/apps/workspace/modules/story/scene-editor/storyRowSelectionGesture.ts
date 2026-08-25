import type { StoryBlockId } from "@shared/types/story";
import { selectRange } from "./storySceneBlockUtils";
import { isInteractiveTarget } from "./storySceneDom";
import type { VisibleStoryRow } from "./storySceneEditorTypes";

/**
 * Who selects a row when the author presses it — and what the selection becomes.
 *
 * A row div listens to `mousedown` *and* `click`, because one press is two DOM events and each
 * answers something the other cannot. The press has to act first: it is what starts a row-range drag
 * and what lets the browser paint a native text selection, neither of which can wait for the mouseup.
 * The click has to exist as well: the press declines outright on anything interactive inside the row
 * (a field, a button), and without the click a press that landed on one of those would leave the row
 * unselected.
 *
 * Both of them used to select unconditionally, so a single press selected the row **twice** — which
 * is invisible for a plain click (selecting one row twice is selecting one row) and destroys the two
 * gestures that are not idempotent:
 *
 *  - **Ctrl+click**, which toggles: added on the press, removed again on the click. Net zero.
 *  - **Shift+click**, which ranges from the anchor row: the press moved the anchor onto the row
 *    clicked, so the click's range ran from that row to itself and the range collapsed to one line.
 *
 * The fix is that the two handlers ask the same question and get opposite answers —
 * {@link pressSelectsRow} and {@link clickSelectsRow} — so exactly one of them selects per gesture.
 * They are a pair on purpose: written as one expression and its negation, they cannot drift apart
 * into a gap (nothing selects) or an overlap (the bug above) the way two hand-written conditions can.
 */

/** The part of a mouse event this module reads — the same shape on a React synthetic and a native one. */
export type RowGestureEvent = {
    button: number;
    target: EventTarget | null;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
};

/**
 * Does this `mousedown` select the row?
 *
 * No for a non-primary button — the right button opens the row menu, which selects the row itself —
 * and no when the press landed on something inside the row that answers for it, because taking the
 * press away from a field the author aimed at is what a text input is for. Those are the presses the
 * `click` picks up.
 */
export function pressSelectsRow(event: RowGestureEvent): boolean {
    // A null target is not a thing a real event has - only the native type admits one - so it counts
    // as "nothing inside the row claimed this", which is what the row's own press means.
    return event.button === 0 && !(event.target !== null && isInteractiveTarget(event.target));
}

/** Does this `click` select the row? Exactly when the press before it did not. */
export function clickSelectsRow(event: RowGestureEvent): boolean {
    return !pressSelectsRow(event);
}

/**
 * Is this press unmodified — the one kind that means "start pointing at rows" rather than "edit the
 * selection I already have"?
 *
 * A modified press is a discrete edit: Ctrl toggles this row, Shift extends the range to it. Letting
 * one start a row-range drag as well is what made Ctrl+click unusable with a real hand — a drag
 * replaces the selection with the range under the pointer, and the first stray mousemove of the press
 * (every hand produces one) threw away everything the toggle had just added.
 */
export function isPlainRowPress(event: RowGestureEvent): boolean {
    return !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
}

/**
 * How far the pointer has to travel before a press on a row becomes a drag across rows.
 *
 * Windows' own `SM_CXDRAG`, and the same 4px the interface editor settled on for the same reason
 * (see `lib/ui-editor/interaction/gestureDeadzone`). Kept as its own constant rather than imported
 * from there: what they share is a number about hands, not a dependency.
 *
 * Measured in screen pixels, because it is there to absorb a hand that shook — and a hand does not
 * shake less because the list scrolled.
 */
export const ROW_DRAG_DEADZONE_PX = 4;

/** Whether a press that started at `origin` has travelled far enough to be a drag. */
export function rowDragEngaged(origin: { x: number; y: number }, x: number, y: number): boolean {
    return Math.abs(x - origin.x) >= ROW_DRAG_DEADZONE_PX || Math.abs(y - origin.y) >= ROW_DRAG_DEADZONE_PX;
}

/**
 * The selection after a row is picked: a Shift range from the anchor row, a Ctrl toggle of this one,
 * or this one alone.
 *
 * Toggling the last selected row off would leave nothing selected and no row for the property rail to
 * stand on, so the row stays — a Ctrl+click can empty the selection down to one line, never to none.
 */
export function nextRowSelection(params: {
    previous: ReadonlySet<StoryBlockId>;
    rows: VisibleStoryRow[];
    /**
     * Where a Shift range starts: the *anchor* row — the last row picked without Shift.
     *
     * Not the row that was active before this press, which is the near-miss it reads like: a Shift
     * press moves the active row onto its own head, so a second Shift+click would range from where
     * the first one ended rather than from where the author started. A range that re-anchors on
     * itself can only ever grow away from the first row picked — it can never shrink back toward it,
     * which is half of what Shift+click is for.
     */
    anchorBlockId: StoryBlockId | null;
    blockId: StoryBlockId;
    event?: Pick<RowGestureEvent, "shiftKey" | "ctrlKey" | "metaKey">;
}): Set<StoryBlockId> {
    const { previous, rows, anchorBlockId, blockId, event } = params;
    if (event?.shiftKey && anchorBlockId) {
        return selectRange(rows, anchorBlockId, blockId);
    }
    if (event?.ctrlKey || event?.metaKey) {
        const next = new Set(previous);
        next.has(blockId) ? next.delete(blockId) : next.add(blockId);
        return next.size > 0 ? next : new Set([blockId]);
    }
    return new Set([blockId]);
}
