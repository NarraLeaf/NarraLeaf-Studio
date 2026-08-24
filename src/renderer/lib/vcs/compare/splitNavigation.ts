import type { SplitSlot } from "./splitLayout";

/**
 * Walking a comparison one change at a time.
 *
 * A document with seventeen changes is seventeen places an author has to get to, and scrolling two
 * halves looking for the next coloured glyph is the way that goes wrong: a change one line below the
 * fold is a change nobody sees. Previous and next visit every slot exactly once, and the readout
 * beside them says which one of how many - so an author who has pressed next nine times knows there
 * are eight left rather than believing they have reached the end.
 */

/** Nothing selected. The state the tab opens in: the top of the document, not the first change. */
export const NO_ANCHOR = -1;

/**
 * The next slot in `direction`, wrapping at both ends.
 *
 * Wrapping rather than stopping, because the alternative is a control that disables itself at the
 * last change - and an author who wants the first change again has nowhere to press. From nothing
 * selected, next is the first and previous is the last.
 */
export function stepAnchor(total: number, current: number, direction: 1 | -1): number {
    if (total <= 0) {
        return NO_ANCHOR;
    }
    if (current < 0 || current >= total) {
        return direction === 1 ? 0 : total - 1;
    }
    return (current + direction + total) % total;
}

/**
 * The change's own path, as the halves write it into the DOM.
 *
 * `DocumentChange.path` is the one stable name a change has - the same handle a merge decision is
 * taken on - and until now it reached the DOM only as a tooltip, which is text and not an address.
 * The halves emit it as `data-change-path` so that anything scrolling to a change, on either side,
 * is naming what the comparison named rather than a row index that changes with the budget.
 */
export function changePathAttribute(path: readonly string[]): string {
    return path.join("/");
}

/** The slot at an index, or null for nothing selected. */
export function anchorAt(slots: readonly SplitSlot[], index: number): SplitSlot | null {
    return index >= 0 && index < slots.length ? slots[index] : null;
}
