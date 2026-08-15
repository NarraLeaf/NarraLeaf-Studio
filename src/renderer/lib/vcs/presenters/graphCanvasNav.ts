import {
    clampSurfaceWheelDelta,
    normalizeSurfaceWheelDelta,
    resolveSurfaceWheelPageDelta,
    SURFACE_PINCH_ZOOM_DELTA_LIMIT_PX,
} from "@/lib/ui-editor/interaction/surfaceWheelInput";

/**
 * Getting close enough to a blueprint graph to read it, without either column moving on its own.
 *
 * A graph of any size is fitted into one column of a comparison pane, and at thirty nodes the cards
 * are still cards while their titles are no longer letters. The shape of the change is visible and
 * the identity of the changed node is not, which is half an answer.
 *
 * **This is a layer over the fitted view, not a replacement for it.** {@link sharedGraphViewport}
 * already decides the one box and the one scale both columns are drawn in, and that computation is
 * what makes a node that never moved appear in the same place on both sides. So a pan is a pair of
 * pixel offsets and a zoom is a multiplier, both applied to the picture that fit produced - one
 * transform, held once, handed to both columns. Fit is therefore not a computation at all: it is
 * this transform back at identity.
 *
 * **One transform for the pair, which is the point.** Two columns each with their own pan would
 * show the same node at two different places the moment either was touched, and the reason to draw
 * two graphs side by side rather than one after the other would be gone.
 */

/** A pan and a zoom over the fitted picture, in drawn pixels. `x`/`y` are where its origin lands. */
export interface GraphNav {
    /** Multiplier on the fitted scale. 1 draws the whole graph exactly as fit left it. */
    readonly zoom: number;
    readonly x: number;
    readonly y: number;
}

/** The whole graph in the frame: what the canvas opens at, and what the fit control returns to. */
export const FITTED_GRAPH_NAV: GraphNav = { zoom: 1, x: 0, y: 0 };

/**
 * The band the drawn scale stays inside - the fitted scale times the zoom, not the zoom alone.
 *
 * A multiplier on its own is the wrong thing to bound: 8x is nothing on a graph fitted at 0.06 and
 * absurd on one fitted at 1. The floor is never allowed to push the fitted view out of reach, so a
 * graph so large that fitting it already falls below the floor can be zoomed in and no further out.
 */
export const GRAPH_NAV_MIN_SCALE = 0.1;
export const GRAPH_NAV_MAX_SCALE = 4;

/**
 * How fast a wheel notch changes the scale.
 *
 * The interface editor's ctrl-wheel figures, not a second set: the two canvases are a minute apart
 * in an author's hands and a zoom that moved at a different rate in each would be felt as one of
 * them being wrong. Exponential rather than additive, so a notch is the same proportion of the
 * scale at every scale.
 */
const ZOOM_SPEED = 0.006;

export function isFittedGraphNav(nav: GraphNav): boolean {
    return nav.zoom === 1 && nav.x === 0 && nav.y === 0;
}

/** The zoom, held inside the band {@link GRAPH_NAV_MIN_SCALE} and {@link GRAPH_NAV_MAX_SCALE} set. */
export function clampGraphNavZoom(zoom: number, fittedScale: number): number {
    if (!Number.isFinite(zoom) || zoom <= 0) {
        return 1;
    }
    const fitted = Number.isFinite(fittedScale) && fittedScale > 0 ? fittedScale : 1;
    const low = Math.min(GRAPH_NAV_MIN_SCALE / fitted, 1);
    const high = Math.max(GRAPH_NAV_MAX_SCALE / fitted, 1);
    return Math.min(Math.max(zoom, low), high);
}

/** The view dragged by a pointer's travel. A drag moves the picture, not the window onto it. */
export function panGraphNav(nav: GraphNav, dx: number, dy: number): GraphNav {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        return nav;
    }
    return { zoom: nav.zoom, x: nav.x + dx, y: nav.y + dy };
}

/**
 * What one wheel event multiplies the zoom by.
 *
 * The delta is normalized and capped first, both for the reason the interface editor does it: a
 * wheel reports in lines or pages on some devices and in wildly uneven pixel jumps on others, and
 * an uncapped notch from a coarse mouse would cross the whole band in one turn.
 */
export function graphNavZoomFactor(deltaY: number, deltaMode: number, framePx: number): number {
    const normalized = normalizeSurfaceWheelDelta(deltaY, deltaMode, resolveSurfaceWheelPageDelta(framePx));
    const capped = clampSurfaceWheelDelta(normalized, SURFACE_PINCH_ZOOM_DELTA_LIMIT_PX);
    return Math.exp(-capped * ZOOM_SPEED);
}

/**
 * The view zoomed about a point of the frame, which stays where it is.
 *
 * Zooming about the frame's corner would send whatever the author is reading off the edge on the
 * way in; zooming about the pointer keeps the node they are pointing at under the pointer. The
 * anchor is in the frame the wheel happened over, so the other column moves by the same amount in
 * graph terms - the two stay in step.
 */
export function zoomGraphNavAt(
    nav: GraphNav,
    factor: number,
    anchorX: number,
    anchorY: number,
    fittedScale: number,
): GraphNav {
    if (!Number.isFinite(factor) || factor <= 0 || nav.zoom <= 0) {
        return nav;
    }
    const held = graphNavPoint(anchorX, anchorY, nav);
    const zoom = clampGraphNavZoom(nav.zoom * factor, fittedScale);
    return { zoom, x: anchorX - held.x * zoom, y: anchorY - held.y * zoom };
}

/** A box of the fitted picture, where the current view draws it. */
export function graphNavBox(
    box: { left: number; top: number; width: number; height: number },
    nav: GraphNav,
): { left: number; top: number; width: number; height: number } {
    return {
        left: box.left * nav.zoom + nav.x,
        top: box.top * nav.zoom + nav.y,
        width: box.width * nav.zoom,
        height: box.height * nav.zoom,
    };
}

/**
 * A point of the frame, in the fitted picture's coordinates - {@link graphNavBox} run backwards.
 *
 * Composed with the viewport it reaches graph coordinates (`viewport.x + fitted / viewport.scale`),
 * which is the only route between what a pointer reports and what a node's layout says.
 */
export function graphNavPoint(
    canvasX: number,
    canvasY: number,
    nav: GraphNav,
): { x: number; y: number } {
    const zoom = nav.zoom > 0 ? nav.zoom : 1;
    return { x: (canvasX - nav.x) / zoom, y: (canvasY - nav.y) / zoom };
}
