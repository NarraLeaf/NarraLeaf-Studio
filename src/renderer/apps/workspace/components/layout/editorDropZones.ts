/**
 * Geometry for the editor pane drop zones: where a drag hovering over a group would land.
 *
 * "center" drops into the group as another tab; the four edges split the group and put the dropped
 * editor in the new pane on that side.
 */
export type EditorDropZone = "center" | "left" | "right" | "top" | "bottom";

/** Fraction of the pane's width/height each edge band claims. */
export const EDITOR_DROP_EDGE_RATIO = 0.24;

export interface EditorDropRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * Which zone a pointer at (x, y) is in. The nearest edge wins when the pointer is inside its band,
 * otherwise the drop is a plain tab-into-this-group. Ties prefer the horizontal edges, which is
 * where a corner drag is more often headed.
 */
export function resolveEditorDropZone(
    rect: EditorDropRect,
    x: number,
    y: number,
    edgeRatio: number = EDITOR_DROP_EDGE_RATIO,
): EditorDropZone {
    if (rect.width <= 0 || rect.height <= 0) {
        return "center";
    }
    const relativeX = (x - rect.left) / rect.width;
    const relativeY = (y - rect.top) / rect.height;
    const candidates: { zone: EditorDropZone; distance: number }[] = [
        { zone: "left", distance: relativeX },
        { zone: "right", distance: 1 - relativeX },
        { zone: "top", distance: relativeY },
        { zone: "bottom", distance: 1 - relativeY },
    ];

    let nearest = candidates[0];
    for (const candidate of candidates) {
        if (candidate.distance < nearest.distance) {
            nearest = candidate;
        }
    }
    return nearest.distance < edgeRatio ? nearest.zone : "center";
}

export interface EditorDropSplit {
    direction: "horizontal" | "vertical";
    /** "before" = new pane left/above the target, "after" = right/below. */
    side: "before" | "after";
}

/** The split a zone asks for, or null for "center" (no split - drop into the group). */
export function editorDropZoneToSplit(zone: EditorDropZone): EditorDropSplit | null {
    switch (zone) {
        case "left":
            return { direction: "horizontal", side: "before" };
        case "right":
            return { direction: "horizontal", side: "after" };
        case "top":
            return { direction: "vertical", side: "before" };
        case "bottom":
            return { direction: "vertical", side: "after" };
        case "center":
            return null;
    }
}

export interface EditorDropPreviewRect {
    left: string;
    top: string;
    width: string;
    height: string;
}

/**
 * The area the dropped editor will occupy, as percentages of the group - the overlay draws this so
 * the resulting layout is visible before releasing, with no label needed to explain it.
 */
export function editorDropZonePreviewRect(zone: EditorDropZone): EditorDropPreviewRect {
    switch (zone) {
        case "left":
            return { left: "0%", top: "0%", width: "50%", height: "100%" };
        case "right":
            return { left: "50%", top: "0%", width: "50%", height: "100%" };
        case "top":
            return { left: "0%", top: "0%", width: "100%", height: "50%" };
        case "bottom":
            return { left: "0%", top: "50%", width: "100%", height: "50%" };
        case "center":
            return { left: "0%", top: "0%", width: "100%", height: "100%" };
    }
}

/**
 * Where a tab dropped at `x` should be inserted, given the tab headers' bounding rects in strip
 * order. Splits each header at its midpoint so the caret follows the pointer's nearer edge.
 */
export function resolveTabInsertIndex(
    tabRects: readonly EditorDropRect[],
    x: number,
): number {
    for (let index = 0; index < tabRects.length; index++) {
        const rect = tabRects[index];
        if (x < rect.left + rect.width / 2) {
            return index;
        }
    }
    return tabRects.length;
}
