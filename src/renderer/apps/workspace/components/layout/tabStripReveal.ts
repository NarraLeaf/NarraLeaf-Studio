/**
 * Geometry for keeping the active editor tab visible in an overflowing tab strip.
 *
 * The strip scrolls horizontally; when focus moves to a tab that is off-screen - via a command, the
 * quick-switcher, or a close that reactivated a neighbour - the header has to be scrolled back into
 * view, or the user is left hunting for the tab they are actually on. The DOM measuring lives in the
 * component; this is the pure "where should the strip be scrolled to" so it can be tested directly.
 */

export interface StripRevealMetrics {
    /** Current horizontal scroll offset of the strip viewport. */
    scrollLeft: number;
    /** Visible width of the strip viewport. */
    clientWidth: number;
    /** Full scrollable width of the strip content. */
    scrollWidth: number;
}

export interface TabRevealMetrics {
    /** Tab's left edge measured from the content's start, so it does not move as the strip scrolls. */
    offsetLeft: number;
    /** Tab header width. */
    width: number;
}

/**
 * The `scrollLeft` that brings `tab` fully into view with `margin` px of breathing room on the side
 * it was clipped, or null when the tab is already visible (or the strip cannot scroll at all).
 *
 * A tab clipped past the left edge scrolls so its left edge (minus the margin) meets the viewport's
 * left; one clipped past the right edge scrolls so its right edge (plus the margin) meets the
 * viewport's right. The target is clamped to the strip's real scroll range, and a target equal to
 * the current position returns null so callers can skip a no-op write.
 */
export function tabStripRevealScrollLeft(
    strip: StripRevealMetrics,
    tab: TabRevealMetrics,
    margin: number = 0,
): number | null {
    const maxScroll = strip.scrollWidth - strip.clientWidth;
    if (maxScroll <= 0) {
        return null;
    }

    const viewLeft = strip.scrollLeft;
    const viewRight = strip.scrollLeft + strip.clientWidth;
    const tabLeft = tab.offsetLeft;
    const tabRight = tab.offsetLeft + tab.width;

    let target: number;
    if (tabLeft - margin < viewLeft) {
        target = tabLeft - margin;
    } else if (tabRight + margin > viewRight) {
        target = tabRight + margin - strip.clientWidth;
    } else {
        return null;
    }

    const clamped = Math.max(0, Math.min(maxScroll, target));
    return clamped === strip.scrollLeft ? null : clamped;
}
