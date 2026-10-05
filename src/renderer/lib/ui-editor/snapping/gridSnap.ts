/**
 * The canvas grid - one number, the distance between grid lines in design pixels, with square cells.
 *
 * The grid belongs to the screen being edited, not to whatever container an element sits in: its
 * origin is the surface's top-left corner (in the component editor, the component's top-left, which
 * the editor draws at the origin), and every coordinate here is in surface space. A child of an
 * offset container therefore lands on the same points as a top-level element; turning that into the
 * child's own `x`/`y` is the caller's job, through the parent's surface top-left.
 *
 * Editor-only. The spacing is a per-project editor preference (`UIEditorStateService`), never part
 * of the UI document, and nothing here reaches the game.
 */

export const DEFAULT_UI_EDITOR_GRID_SPACING = 20;
export const MIN_UI_EDITOR_GRID_SPACING = 1;
export const MAX_UI_EDITOR_GRID_SPACING = 1000;

/**
 * The smallest distance, in screen pixels, the canvas lets two drawn grid lines come to each other.
 * Below it the drawing thins out (see {@link resolveGridDisplayStep}); snapping never does.
 */
export const UI_EDITOR_GRID_MIN_SCREEN_CELL_PX = 10;

/** A stored or typed spacing, as a whole number of design pixels in range; `null` when it is not one. */
export function normalizeUiEditorGridSpacing(raw: unknown): number | null {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return null;
    }
    const spacing = Math.round(raw);
    if (spacing < MIN_UI_EDITOR_GRID_SPACING || spacing > MAX_UI_EDITOR_GRID_SPACING) {
        return null;
    }
    return spacing;
}

/** What the spacing field accepts: a number, rounded to whole design pixels, in range. */
export function parseUiEditorGridSpacing(text: string): number | null {
    const trimmed = text.trim();
    if (trimmed === "") {
        return null;
    }
    return normalizeUiEditorGridSpacing(Number(trimmed));
}

/**
 * The grid line nearest to `value` along one axis, in surface space.
 *
 * Halfway ties go towards positive infinity (`Math.round`), so the answer depends only on the
 * value and never on the direction something was moving. `-0` comes back as `0`.
 */
export function nearestGridValue(value: number, spacing: number): number {
    if (!Number.isFinite(value) || !(spacing > 0)) {
        return value;
    }
    const snapped = Math.round(value / spacing) * spacing;
    return snapped === 0 ? 0 : snapped;
}

/** The grid point nearest to a surface-space point. */
export function nearestGridPoint(point: { x: number; y: number }, spacing: number): { x: number; y: number } {
    return { x: nearestGridValue(point.x, spacing), y: nearestGridValue(point.y, spacing) };
}

/**
 * The translation a moving selection takes once the grid has had its say.
 *
 * Per axis: a guide that caught the selection (an element's or the canvas's edge or centre within
 * the snap threshold, `guideDx`/`guideDy` non-null) decides that axis, because the guide is drawn
 * and the author can see what the element lined up with. Every other axis puts the selection's
 * top-left corner on the nearest grid line, wherever it is - the grid is not a threshold snap, so a
 * drop with grid snapping on lands on the grid unless a drawn guide says otherwise.
 *
 * `topLeft` is the selection's top-left before either snap is applied.
 */
export function resolveGridTranslate(params: {
    topLeft: { x: number; y: number };
    spacing: number;
    guideDx: number | null;
    guideDy: number | null;
}): { dx: number; dy: number } {
    const { topLeft, spacing, guideDx, guideDy } = params;
    return {
        dx: guideDx ?? nearestGridValue(topLeft.x, spacing) - topLeft.x,
        dy: guideDy ?? nearestGridValue(topLeft.y, spacing) - topLeft.y,
    };
}

/**
 * Snaps the one moving edge of a box being resized to the grid, keeping the opposite edge where it is.
 *
 * `moving` is the dragged edge's position, `anchored` the opposite one's. The nearest grid line is
 * taken unless it would leave the box narrower than `minExtent` (or turn it inside out), in which case
 * the next line outwards from the anchored edge is - the grid never produces an empty box.
 */
export function snapResizeEdgeToGrid(moving: number, anchored: number, spacing: number, minExtent: number): number {
    const nearest = nearestGridValue(moving, spacing);
    const outward = moving >= anchored ? 1 : -1;
    if ((nearest - anchored) * outward >= minExtent) {
        return nearest;
    }
    // The first grid line at least `minExtent` beyond the anchored edge, on the side being dragged.
    const limit = anchored + outward * minExtent;
    const first = outward > 0 ? Math.ceil(limit / spacing) * spacing : Math.floor(limit / spacing) * spacing;
    return first === 0 ? 0 : first;
}

/**
 * How many grid cells apart the drawn lines are, so that they stay at least `minScreenPx` apart on
 * screen: 1, 2, 5, 10, 20, 50... Only the drawing thins out; snapping still uses every cell.
 */
export function resolveGridDisplayStep(
    spacing: number,
    scale: number,
    minScreenPx: number = UI_EDITOR_GRID_MIN_SCREEN_CELL_PX,
): number {
    const cell = spacing * scale;
    if (!(cell > 0) || !Number.isFinite(cell)) {
        return 1;
    }
    if (cell >= minScreenPx) {
        return 1;
    }
    for (let magnitude = 1; magnitude <= 1e9; magnitude *= 10) {
        for (const factor of [1, 2, 5]) {
            const step = factor * magnitude;
            if (cell * step >= minScreenPx) {
                return step;
            }
        }
    }
    return 1e9;
}

/** The drawn grid in overlay (viewport) pixels: one entry per line, plus the page box they span. */
export type GridScreenLines = {
    /** Grid cells between two drawn lines (see {@link resolveGridDisplayStep}). */
    step: number;
    /** Overlay x of each vertical line, unrounded. */
    xs: number[];
    /** Overlay y of each horizontal line, unrounded. */
    ys: number[];
    /** The part of the page the lines are drawn across, in overlay pixels, clipped to the overlay. */
    box: { left: number; top: number; right: number; bottom: number };
};

/**
 * Lays the grid out on screen: lines at multiples of `spacing × step`, over the page only
 * (`designSize` from the origin), and only where the overlay can show them.
 *
 * Returns `null` when no part of the page is in view.
 */
export function computeGridScreenLines(params: {
    spacing: number;
    viewport: { scale: number; offsetX: number; offsetY: number };
    designSize: { width: number; height: number };
    overlaySize: { width: number; height: number };
    minScreenPx?: number;
}): GridScreenLines | null {
    const { spacing, viewport, designSize, overlaySize } = params;
    const scale = viewport.scale;
    if (!(spacing > 0) || !(scale > 0)) {
        return null;
    }
    const pageLeft = viewport.offsetX;
    const pageTop = viewport.offsetY;
    const pageRight = viewport.offsetX + designSize.width * scale;
    const pageBottom = viewport.offsetY + designSize.height * scale;
    const box = {
        left: Math.max(0, pageLeft),
        top: Math.max(0, pageTop),
        right: Math.min(overlaySize.width, pageRight),
        bottom: Math.min(overlaySize.height, pageBottom),
    };
    if (box.right <= box.left || box.bottom <= box.top) {
        return null;
    }
    const step = resolveGridDisplayStep(spacing, scale, params.minScreenPx);
    const interval = spacing * step;
    const along = (from: number, to: number, origin: number, extent: number): number[] => {
        // Surface-space range in view, then every drawn line inside it.
        const start = Math.max(0, (from - origin) / scale);
        const end = Math.min(extent, (to - origin) / scale);
        const out: number[] = [];
        for (let i = Math.ceil(start / interval); i * interval <= end; i++) {
            out.push(origin + i * interval * scale);
        }
        return out;
    };
    return {
        step,
        xs: along(box.left, box.right, pageLeft, designSize.width),
        ys: along(box.top, box.bottom, pageTop, designSize.height),
        box,
    };
}
