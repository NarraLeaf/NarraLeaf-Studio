import type { ViewportTransform } from "./types";

/**
 * The bands of the canvas an interface must not be fitted underneath.
 *
 * The surface editor draws its chrome *over* the viewport, not beside it: the outline panel, the
 * tool bar and the docker bar are absolutely positioned siblings of the transformed canvas node, so
 * the viewport box is the whole editing area and none of it is subtracted by layout. A fit that
 * only knew that box would centre the interface underneath the outline panel, and the author would
 * still be missing an edge - which is the complaint this path exists to answer.
 */
export type FitViewportInsets = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

/** Outline panel: `w-64` (256px) plus a hair of breathing room so the border is not flush. */
export const SURFACE_FIT_OUTLINE_PANEL_INSET_PX = 264;

/** Outline panel collapsed: only its round re-open button is left, at `left-3` and `h-10 w-10`. */
export const SURFACE_FIT_OUTLINE_TOGGLE_INSET_PX = 60;

/** Tool bar band at `top-3`, one row of icon buttons tall. */
export const SURFACE_FIT_TOOLBAR_INSET_PX = 56;

/** Docker bar band at `bottom-3`, one row of palette buttons tall. */
export const SURFACE_FIT_DOCKER_INSET_PX = 76;

/** Plain margin on the side no chrome occupies. */
export const SURFACE_FIT_EDGE_INSET_PX = 16;

/**
 * Below this the insets are worth less than the space they cost: in a pane this small, an interface
 * fitted under the chrome and readable beats one fitted beside it and microscopic.
 */
export const SURFACE_FIT_MIN_BOX_PX = 96;

/**
 * Ceiling on the automatic fit.
 *
 * Fitting scales up as well as down - a small interface in a large pane should still fill it. Past
 * 2x though, magnification stops being a view of the interface and starts being a lie about it:
 * every hairline the author positions is two pixels wide and nothing lands where it will ship. The
 * author can still zoom past this by hand; it is only what "open it and show me all of it" picks.
 */
export const SURFACE_FIT_MAX_SCALE = 2;

/** Matches the clamp in `UIEditorStateService.normalizeViewport`. */
const SURFACE_FIT_MIN_SCALE = 0.1;

export type SurfaceFitChrome = {
    /** When the outline panel is collapsed only its re-open button occupies the left band. */
    outlineCollapsed: boolean;
};

export function resolveSurfaceFitInsets({ outlineCollapsed }: SurfaceFitChrome): FitViewportInsets {
    return {
        left: outlineCollapsed ? SURFACE_FIT_OUTLINE_TOGGLE_INSET_PX : SURFACE_FIT_OUTLINE_PANEL_INSET_PX,
        top: SURFACE_FIT_TOOLBAR_INSET_PX,
        right: SURFACE_FIT_EDGE_INSET_PX,
        bottom: SURFACE_FIT_DOCKER_INSET_PX,
    };
}

export type ComputeFitViewportParams = {
    /** Viewport element box, in CSS pixels. */
    container: { width: number; height: number };
    /** The interface's authored size, which is what the canvas node renders at scale 1. */
    designSize: { width: number; height: number };
    insets?: FitViewportInsets;
    maxScale?: number;
};

/**
 * The transform that puts the whole interface inside the free part of the canvas, centred.
 *
 * Returns `null` when there is nothing to fit into or nothing to fit - a hidden tab measures 0x0,
 * and a fit computed from that would park the canvas somewhere the author has to hunt for it once
 * the tab is shown again.
 */
export function computeFitViewportTransform({
    container,
    designSize,
    insets,
    maxScale = SURFACE_FIT_MAX_SCALE,
}: ComputeFitViewportParams): ViewportTransform | null {
    if (
        !Number.isFinite(container.width) ||
        !Number.isFinite(container.height) ||
        container.width <= 0 ||
        container.height <= 0
    ) {
        return null;
    }
    if (
        !Number.isFinite(designSize.width) ||
        !Number.isFinite(designSize.height) ||
        designSize.width <= 0 ||
        designSize.height <= 0
    ) {
        return null;
    }

    const applied = insets ?? { left: 0, top: 0, right: 0, bottom: 0 };
    let boxX = applied.left;
    let boxY = applied.top;
    let boxWidth = container.width - applied.left - applied.right;
    let boxHeight = container.height - applied.top - applied.bottom;
    if (boxWidth < SURFACE_FIT_MIN_BOX_PX || boxHeight < SURFACE_FIT_MIN_BOX_PX) {
        boxX = 0;
        boxY = 0;
        boxWidth = container.width;
        boxHeight = container.height;
    }

    const rawScale = Math.min(boxWidth / designSize.width, boxHeight / designSize.height);
    const scale = Math.max(SURFACE_FIT_MIN_SCALE, Math.min(maxScale, rawScale));

    return {
        scale,
        offsetX: Math.round(boxX + (boxWidth - designSize.width * scale) / 2),
        offsetY: Math.round(boxY + (boxHeight - designSize.height * scale) / 2),
    };
}

/** Whether two transforms are the same to the precision the canvas can actually draw. */
export function areViewportTransformsEqual(a: ViewportTransform, b: ViewportTransform): boolean {
    return (
        Math.abs(a.scale - b.scale) < 1e-4 &&
        Math.abs(a.offsetX - b.offsetX) < 0.5 &&
        Math.abs(a.offsetY - b.offsetY) < 0.5
    );
}
