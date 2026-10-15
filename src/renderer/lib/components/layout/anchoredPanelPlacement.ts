/**
 * Where a panel opened from a control - an asset picker, the motion picker - is drawn.
 *
 * Three promises, each one a defect it replaced:
 *
 * - **It stays beside its column.** A panel wider than its trigger grows away from the window's
 *   nearer edge: one opened from the right dock lines up with the trigger's right edge and grows to
 *   the left, rather than running on over the rail beside the dock.
 * - **It never covers the control it was opened from.** On the side it opens to, it is held to the
 *   room there is; it is never pushed back over the trigger to fit.
 * - **It does not move while it is open.** The side is chosen once, for the tallest the panel can
 *   be, and the caller keeps it for as long as the panel stays open (`side`). Below, the top edge is
 *   fixed and the panel grows downward. Above, the panel takes the whole height it is given, so
 *   opening a folder inside it scrolls its list instead of lifting the header out from under the
 *   pointer - or, as it did, flipping it over its own row.
 */

export type AnchoredPanelSide = "below" | "above";

export type AnchorRect = {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
};

export type AnchoredPanelViewport = {
    width: number;
    height: number;
    /** The first row a panel may be drawn on: below the window's title bar. */
    top: number;
};

/** Space kept between a panel and the window's edges. */
export const ANCHORED_PANEL_MARGIN = 12;
/** Space between a panel and its trigger. */
export const ANCHORED_PANEL_GAP = 8;

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * The panel's left edge. Lined up with the trigger's left edge, unless the panel is wider than the
 * trigger and the trigger sits in the right half of the window - then with its right edge, so the
 * extra width goes over the editor rather than over whatever is to the right of the trigger's column.
 */
export function placeAnchoredPanelX(anchor: AnchorRect, panelWidth: number, viewportWidth: number): number {
    const centre = (anchor.left + anchor.right) / 2;
    const growsLeft = panelWidth > anchor.width && centre > viewportWidth / 2;
    const left = growsLeft ? anchor.right - panelWidth : anchor.left;
    return clamp(left, ANCHORED_PANEL_MARGIN, viewportWidth - ANCHORED_PANEL_MARGIN - panelWidth);
}

export type AnchoredPanelPlacement = {
    side: AnchoredPanelSide;
    top: number;
    left: number;
    width: number;
    /** The tallest the panel may grow to here. */
    maxHeight: number;
    /**
     * The height the panel takes, when it is fixed: above its trigger, where a panel that grew would
     * have to move its top edge. Absent below, where it sizes to its content.
     */
    height?: number;
};

export function placeAnchoredPanel(input: {
    anchor: AnchorRect;
    viewport: AnchoredPanelViewport;
    /** The panel's width bounds; the trigger's own width, held to them. */
    minWidth: number;
    maxWidth: number;
    /** The panel's own cap on its height. */
    maxHeight: number;
    /** The side chosen when the panel opened, kept until it closes. */
    side?: AnchoredPanelSide;
}): AnchoredPanelPlacement {
    const { anchor, viewport } = input;
    const width = Math.min(
        clamp(anchor.width, input.minWidth, input.maxWidth),
        Math.max(0, viewport.width - ANCHORED_PANEL_MARGIN * 2),
    );
    const left = placeAnchoredPanelX(anchor, width, viewport.width);

    const roomBelow = Math.max(0, viewport.height - ANCHORED_PANEL_MARGIN - (anchor.bottom + ANCHORED_PANEL_GAP));
    const roomAbove = Math.max(0, anchor.top - ANCHORED_PANEL_GAP - viewport.top);
    const side: AnchoredPanelSide = input.side
        ?? (roomBelow >= input.maxHeight || roomBelow >= roomAbove ? "below" : "above");

    if (side === "below") {
        return {
            side,
            top: anchor.bottom + ANCHORED_PANEL_GAP,
            left,
            width,
            maxHeight: Math.min(input.maxHeight, roomBelow),
        };
    }
    const height = Math.min(input.maxHeight, roomAbove);
    return {
        side,
        top: anchor.top - ANCHORED_PANEL_GAP - height,
        left,
        width,
        maxHeight: height,
        height,
    };
}
