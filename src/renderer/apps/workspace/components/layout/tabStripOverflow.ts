/**
 * Which edges of an overflowing editor tab strip have tabs hidden behind them.
 *
 * The strip hides its scrollbar (it is chrome sitting on a 36px row, and an 8px gutter under the
 * tabs costs more than it says), so the "there is more this way" signal has to come from somewhere
 * else: a short fade at whichever edge is currently clipping content. The DOM measuring lives in the
 * component; this is the pure "which edges are clipped" so it can be tested directly.
 */

export interface StripOverflowMetrics {
    /** Current horizontal scroll offset of the strip viewport. */
    scrollLeft: number;
    /** Visible width of the strip viewport. */
    clientWidth: number;
    /** Full scrollable width of the strip content. */
    scrollWidth: number;
}

export interface StripOverflow {
    /** Content is scrolled out past the strip's left edge. */
    left: boolean;
    /** Content continues past the strip's right edge. */
    right: boolean;
}

/**
 * Slack, in px, before a difference counts as overflow.
 *
 * Widths here are fractional - a tab row is laid out from text, not from round numbers - and
 * `scrollWidth` rounds up while `clientWidth` rounds down, so a strip whose tabs fit exactly can
 * still report a sub-pixel overflow. Without this the last tab in a strip that fits would sit under
 * a permanent fade.
 */
const EPSILON = 1;

/** The edges of `strip` that are currently clipping tabs. */
export function tabStripOverflow(strip: StripOverflowMetrics): StripOverflow {
    return {
        left: strip.scrollLeft > EPSILON,
        right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - EPSILON,
    };
}
