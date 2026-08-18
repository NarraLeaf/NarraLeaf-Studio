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
 * The range a zoom may land in, whether it was computed or typed.
 *
 * `UIEditorStateService.normalizeViewport` clamps to exactly this, and the wheel zoom to the same
 * numbers, so the zoom box in the tool bar can refuse a value before it is silently rewritten.
 */
export const SURFACE_ZOOM_MIN_SCALE = 0.1;
export const SURFACE_ZOOM_MAX_SCALE = 10;

/**
 * Ceiling on the fit nobody asked for.
 *
 * Fitting scales up as well as down - a small interface in a large pane should still fill it. Past
 * 2x though, magnification stops being a view of the interface and starts being a lie about it:
 * every hairline the author positions is two pixels wide and nothing lands where it will ship.
 *
 * It binds the fit the editor computes by itself, on open and on resize. A mode the author picked
 * from the zoom menu is a stated intent and does what it says instead - "fill the editing area"
 * that stopped at 2x and left a margin would be a broken promise, and typing a number is the
 * author saying the magnification is the point.
 */
export const SURFACE_FIT_MAX_SCALE = 2;

export type SurfaceFitChrome = {
  /** When the outline panel is collapsed only its re-open button occupies the left band. */
  outlineCollapsed: boolean;
};

export function resolveSurfaceFitInsets({ outlineCollapsed }: SurfaceFitChrome): FitViewportInsets {
  return {
    left: outlineCollapsed
      ? SURFACE_FIT_OUTLINE_TOGGLE_INSET_PX
      : SURFACE_FIT_OUTLINE_PANEL_INSET_PX,
    top: SURFACE_FIT_TOOLBAR_INSET_PX,
    right: SURFACE_FIT_EDGE_INSET_PX,
    bottom: SURFACE_FIT_DOCKER_INSET_PX
  };
}

/**
 * How a computed zoom answers the space it was given.
 *
 * - `contain` - all of the content is inside the box. The one an editor picks by itself.
 * - `cover` - the box has no empty side left; whatever does not fit runs past the edge.
 * - `width` - the content spans the box horizontally, however tall that makes it.
 * - `actual` - one content pixel is one screen pixel, which is the only mode that ignores the box
 *   for its scale and uses it only to decide where the centre is.
 *
 * Shared vocabulary rather than a surface-editor one: the blueprint canvas offers the same four
 * answers about a graph's bounding box, and one word per idea is what lets the two canvases be
 * translated once and read the same way.
 */
export type CanvasFitMode = "contain" | "cover" | "width" | "actual";

/** Menu order, wherever the four are offered. */
export const CANVAS_FIT_MODES: readonly CanvasFitMode[] = ["actual", "contain", "cover", "width"];

/** A computed zoom, and whether the author asked for it or the editor decided. */
export type SurfaceViewportFit = {
  mode: CanvasFitMode;
  /**
   * True when the mode came from the zoom menu. It survives a resize the same way, and only this
   * one escapes {@link SURFACE_FIT_MAX_SCALE}.
   */
  chosen: boolean;
};

export type FitViewportBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * The part of the viewport a computed zoom is allowed to work in.
 *
 * Every mode shares this one box on purpose: "fit" and "fill" that measured themselves against
 * different rectangles would move the interface when the author switched between them for reasons
 * nothing on screen explains.
 *
 * Returns `null` when the viewport cannot be measured - a hidden tab measures 0x0, and a zoom
 * computed from that would park the canvas somewhere the author has to hunt for once the tab is
 * shown again.
 */
export function resolveFitViewportBox(
  container: { width: number; height: number },
  insets?: FitViewportInsets
): FitViewportBox | null {
  if (
    !Number.isFinite(container.width) ||
    !Number.isFinite(container.height) ||
    container.width <= 0 ||
    container.height <= 0
  ) {
    return null;
  }

  const applied = insets ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const box = {
    x: applied.left,
    y: applied.top,
    width: container.width - applied.left - applied.right,
    height: container.height - applied.top - applied.bottom
  };
  if (box.width < SURFACE_FIT_MIN_BOX_PX || box.height < SURFACE_FIT_MIN_BOX_PX) {
    return { x: 0, y: 0, width: container.width, height: container.height };
  }
  return box;
}

export type ComputeFitViewportParams = {
  /** Viewport element box, in CSS pixels. */
  container: { width: number; height: number };
  /** The interface's authored size, which is what the canvas node renders at scale 1. */
  designSize: { width: number; height: number };
  insets?: FitViewportInsets;
  /** Defaults to `contain`, the answer to "show me all of it". */
  mode?: CanvasFitMode;
  maxScale?: number;
};

/**
 * The transform that answers `mode` inside the free part of the canvas, centred.
 *
 * Returns `null` when there is nothing to fit into or nothing to fit.
 */
export function computeFitViewportTransform({
  container,
  designSize,
  insets,
  mode = "contain",
  maxScale = SURFACE_FIT_MAX_SCALE
}: ComputeFitViewportParams): ViewportTransform | null {
  const box = resolveFitViewportBox(container, insets);
  if (!box) {
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

  const byWidth = box.width / designSize.width;
  const byHeight = box.height / designSize.height;
  const rawScale =
    mode === "actual"
      ? 1
      : mode === "width"
        ? byWidth
        : mode === "cover"
          ? Math.max(byWidth, byHeight)
          : Math.min(byWidth, byHeight);
  const scale = clampSurfaceZoomScale(rawScale, maxScale);

  // Centred in every mode, including the ones that overflow: an interface wider than the box
  // then runs past both edges by the same amount, which is the only placement that does not
  // silently pick one edge of the author's layout to hide.
  return {
    scale,
    offsetX: Math.round(box.x + (box.width - designSize.width * scale) / 2),
    offsetY: Math.round(box.y + (box.height - designSize.height * scale) / 2)
  };
}

/**
 * The transform that lands on `nextScale` while the middle of the box keeps showing what it shows.
 *
 * This is what a typed zoom uses. Re-centring instead would be simpler, but an author who has
 * panned to a corner and then asks for 150% wants that corner bigger, not the interface back.
 */
export function computeZoomedViewportTransform({
  current,
  container,
  insets,
  nextScale
}: {
  current: ViewportTransform;
  container: { width: number; height: number };
  insets?: FitViewportInsets;
  nextScale: number;
}): ViewportTransform | null {
  const box = resolveFitViewportBox(container, insets);
  if (!box || !Number.isFinite(nextScale)) {
    return null;
  }
  const scale = clampSurfaceZoomScale(nextScale, SURFACE_ZOOM_MAX_SCALE);
  const anchorX = box.x + box.width / 2;
  const anchorY = box.y + box.height / 2;
  // Where the anchor sits in the interface's own coordinates, which must not move.
  const surfaceX = (anchorX - current.offsetX) / Math.max(current.scale, SURFACE_ZOOM_MIN_SCALE);
  const surfaceY = (anchorY - current.offsetY) / Math.max(current.scale, SURFACE_ZOOM_MIN_SCALE);
  return {
    scale,
    offsetX: Math.round(anchorX - surfaceX * scale),
    offsetY: Math.round(anchorY - surfaceY * scale)
  };
}

/** The range a canvas accepts. Blueprint graphs run a much narrower one than the surface editor. */
export type ZoomRange = { min: number; max: number };

export const SURFACE_ZOOM_RANGE: ZoomRange = {
  min: SURFACE_ZOOM_MIN_SCALE,
  max: SURFACE_ZOOM_MAX_SCALE
};

/** Holds a zoom inside the range the canvas accepts, whoever asked for it. */
export function clampSurfaceZoomScale(
  scale: number,
  maxScale: number = SURFACE_ZOOM_MAX_SCALE
): number {
  if (!Number.isFinite(scale)) {
    return SURFACE_ZOOM_MIN_SCALE;
  }
  return Math.max(SURFACE_ZOOM_MIN_SCALE, Math.min(maxScale, scale));
}

/**
 * The zoom an author typed, as a scale.
 *
 * Accepts what a percentage box realistically receives - `150`, `150%`, `1 50`, a full-width `％`
 * from an IME - and returns `null` for anything that is not a number, so the box can keep the value
 * it had rather than jump to a clamped guess of what was meant. A number out of range is clamped
 * instead, because "as far as this canvas goes" is a sensible reading of it.
 *
 * `range` is the canvas's own; both canvases parse the same way and only disagree about the limits.
 */
export function parseZoomPercent(
  input: string,
  range: ZoomRange = SURFACE_ZOOM_RANGE
): number | null {
  const cleaned = input.replace(/[%％\s,]/g, "");
  if (!cleaned || !/^\d*\.?\d+$/.test(cleaned)) {
    return null;
  }
  const percent = Number(cleaned);
  if (!Number.isFinite(percent) || percent <= 0) {
    return null;
  }
  return Math.max(range.min, Math.min(range.max, percent / 100));
}

/** The percentage a zoom control shows for a scale. */
export function formatZoomPercent(scale: number): number {
  return Math.round(scale * 100);
}

/** Whether two transforms are the same to the precision the canvas can actually draw. */
export function areViewportTransformsEqual(a: ViewportTransform, b: ViewportTransform): boolean {
  return (
    Math.abs(a.scale - b.scale) < 1e-4 &&
    Math.abs(a.offsetX - b.offsetX) < 0.5 &&
    Math.abs(a.offsetY - b.offsetY) < 0.5
  );
}
