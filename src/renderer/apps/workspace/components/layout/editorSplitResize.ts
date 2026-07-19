/** Thickness of the gutter between two panes, in px. The grab area is wider - see the sash. */
export const EDITOR_SASH_SIZE = 4;

/**
 * Smallest a pane may be dragged to, in px. A pane squeezed to nothing would still render its tab
 * strip but give the user no way to grab it back, so the sash stops short of collapsing either side.
 */
export const EDITOR_MIN_PANE_PX = 80;

/** Ratio a fresh split starts at, and what a double-click on the sash restores. */
export const EDITOR_DEFAULT_SPLIT_RATIO = 0.5;

/**
 * The first pane's share of the axis for a sash dragged to `pointerOffset` px from the container's
 * leading edge, clamped so neither pane drops below `minPanePx`.
 *
 * A container too small to hold two minimum panes has no room to honour the clamp, so it splits
 * evenly rather than snapping to one arbitrary side.
 */
export function resolveSplitRatio(
    containerSize: number,
    pointerOffset: number,
    minPanePx: number = EDITOR_MIN_PANE_PX,
): number {
    if (!Number.isFinite(containerSize) || containerSize <= 0) {
        return EDITOR_DEFAULT_SPLIT_RATIO;
    }
    if (containerSize < minPanePx * 2) {
        return EDITOR_DEFAULT_SPLIT_RATIO;
    }
    const minRatio = minPanePx / containerSize;
    const raw = pointerOffset / containerSize;
    return Math.min(1 - minRatio, Math.max(minRatio, raw));
}

/** Move a sash by `deltaPx` (keyboard resize), under the same clamp as a drag. */
export function nudgeSplitRatio(
    currentRatio: number,
    containerSize: number,
    deltaPx: number,
    minPanePx: number = EDITOR_MIN_PANE_PX,
): number {
    if (!Number.isFinite(containerSize) || containerSize <= 0) {
        return currentRatio;
    }
    return resolveSplitRatio(containerSize, currentRatio * containerSize + deltaPx, minPanePx);
}

/**
 * Flex basis for the leading pane. The gutter is a real flex item, so the pane gives up half of it
 * on each side - otherwise the two percentages plus the gutter overflow the container.
 */
export function leadingPaneBasis(ratio: number, sashSize: number = EDITOR_SASH_SIZE): string {
    return `calc(${ratio * 100}% - ${sashSize / 2}px)`;
}
