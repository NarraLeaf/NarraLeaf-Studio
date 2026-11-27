/**
 * Where a popover anchored to a run of text goes vertically: under the text when it fits, above the
 * text when it does not, and only as a last resort pushed up against the bottom edge.
 *
 * The popovers on a line being edited (ruby, pause, value, expression, effect, type) used to clamp
 * to the bottom of the window, which near the bottom of the screen slid them up OVER the line they
 * were editing - the one thing on screen the author needed to see while typing into them.
 *
 * `height` is the popover's expected height in CSS pixels; an overestimate is the safe side, since
 * it only flips the popover a little earlier.
 */
export function popoverTopFor(
    anchor: { top: number; bottom: number },
    height: number,
    viewHeight: number,
    gap = 6,
): number {
    const below = anchor.bottom + gap;
    if (below + height <= viewHeight - 8) {
        return below;
    }
    const above = anchor.top - gap - height;
    if (above >= 8) {
        return above;
    }
    return Math.max(8, Math.min(below, viewHeight - height));
}
