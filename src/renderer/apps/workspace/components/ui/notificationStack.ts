/**
 * How many notification cards the corner of the window can actually hold.
 *
 * The toast stack is bounded: it starts below the title bar and stops above the status bar, and
 * it must not reach over the right selector rail. Once the cards no longer fit in that box the
 * remainder does not get drawn half off the edge and it does not get dropped - it waits, and the
 * next one moves up as soon as a card above it is dismissed. The countdown of a waiting card has
 * not started yet (see NotificationContainer), so nothing expires while it is out of sight.
 *
 * Kept apart from the component because the interesting part is arithmetic, and arithmetic is
 * worth asserting without a DOM.
 */

/**
 * The number of leading cards that fit in `available` px when stacked with `gap` px between them.
 *
 * The first card is always counted, however tall it is: a message longer than the window is still
 * a message the author has to be able to read and close, and a stack that showed nothing at all
 * would also never dismiss anything, so the queue behind it could never move.
 *
 * `available <= 0` means "not measured yet" and admits everything - the first paint happens before
 * the container has a box, and a stack that flashed empty on every mount would be worse than one
 * that briefly overflows the clip.
 */
export function visibleCardCount(heights: readonly number[], gap: number, available: number): number {
    if (heights.length === 0) {
        return 0;
    }
    if (!(available > 0)) {
        return heights.length;
    }

    let used = 0;
    let count = 0;
    for (const height of heights) {
        const next = used + (count > 0 ? gap : 0) + height;
        if (count > 0 && next > available) {
            break;
        }
        used = next;
        count += 1;
    }
    return count;
}
