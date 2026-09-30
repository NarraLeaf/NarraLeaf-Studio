/**
 * Where the picture sits in the video preview's viewport, and how zooming and panning move it.
 *
 * Two states. **Fit** follows the viewport: the whole frame, as large as it will go, centred - and it
 * stays that way as the tab is resized, which is what a preview should do until the author asks for
 * something else. **Manual** is a zoom and an offset the author chose, by wheel, by the zoom menu or by
 * double-clicking; it holds its magnification across resizes and only re-clamps the offset.
 *
 * Fit is allowed to enlarge. A 640×360 clip in a large tab is shown the size the tab can give it, the
 * way the stage shows it; "100%" in the zoom menu is one click away when the pixels themselves matter.
 *
 * Pure functions, because this is the part that is easy to get subtly wrong - a zoom that drifts off
 * the pointer, a pan that loses the picture off one edge.
 */

export interface Size {
    width: number;
    height: number;
}

export type FrameView =
    | { mode: "fit" }
    /** `x` and `y` are the picture's top-left corner in viewport pixels. */
    | { mode: "manual"; zoom: number; x: number; y: number };

export interface ResolvedView {
    zoom: number;
    x: number;
    y: number;
}

export const FIT_VIEW: FrameView = { mode: "fit" };

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

/** Steps the zoom menu offers, as fractions. */
export const ZOOM_PRESETS = [0.25, 0.5, 1, 2, 4] as const;

function clampZoom(zoom: number): number {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number.isFinite(zoom) ? zoom : 1));
}

export function fitZoom(viewport: Size, frame: Size): number {
    if (viewport.width <= 0 || viewport.height <= 0 || frame.width <= 0 || frame.height <= 0) {
        return 1;
    }
    return clampZoom(Math.min(viewport.width / frame.width, viewport.height / frame.height));
}

/**
 * Keep the picture reachable. Along an axis where it is smaller than the viewport it is centred;
 * where it is larger, no edge of it may come inside the viewport - there is nothing past the frame
 * to pan to.
 */
function clampAxis(offset: number, scaled: number, available: number): number {
    if (scaled <= available) {
        return (available - scaled) / 2;
    }
    return Math.max(available - scaled, Math.min(0, offset));
}

export function resolveView(view: FrameView, viewport: Size, frame: Size): ResolvedView {
    if (view.mode === "fit") {
        const zoom = fitZoom(viewport, frame);
        return {
            zoom,
            x: (viewport.width - frame.width * zoom) / 2,
            y: (viewport.height - frame.height * zoom) / 2,
        };
    }
    const zoom = clampZoom(view.zoom);
    return {
        zoom,
        x: clampAxis(view.x, frame.width * zoom, viewport.width),
        y: clampAxis(view.y, frame.height * zoom, viewport.height),
    };
}

/**
 * Zoom by `factor`, keeping the picture point under `anchor` (viewport pixels) where it is.
 * Without an anchor the viewport's centre holds still, which is what the zoom menu wants.
 */
export function zoomAt(view: FrameView, viewport: Size, frame: Size, factor: number, anchor?: { x: number; y: number }): FrameView {
    return zoomTo(view, viewport, frame, resolveView(view, viewport, frame).zoom * factor, anchor);
}

export function zoomTo(view: FrameView, viewport: Size, frame: Size, zoom: number, anchor?: { x: number; y: number }): FrameView {
    const current = resolveView(view, viewport, frame);
    const next = clampZoom(zoom);
    const point = anchor ?? { x: viewport.width / 2, y: viewport.height / 2 };
    // The picture coordinate under the anchor, before and after, must be the same.
    const pictureX = (point.x - current.x) / current.zoom;
    const pictureY = (point.y - current.y) / current.zoom;
    const resolved = resolveView(
        { mode: "manual", zoom: next, x: point.x - pictureX * next, y: point.y - pictureY * next },
        viewport,
        frame,
    );
    return { mode: "manual", ...resolved };
}

export function panBy(view: FrameView, viewport: Size, frame: Size, dx: number, dy: number): FrameView {
    const current = resolveView(view, viewport, frame);
    const resolved = resolveView(
        { mode: "manual", zoom: current.zoom, x: current.x + dx, y: current.y + dy },
        viewport,
        frame,
    );
    return { mode: "manual", ...resolved };
}

/** Whether the picture overflows the viewport, i.e. whether a drag has anything to pan. */
export function canPan(view: FrameView, viewport: Size, frame: Size): boolean {
    const { zoom } = resolveView(view, viewport, frame);
    return frame.width * zoom > viewport.width + 0.5 || frame.height * zoom > viewport.height + 0.5;
}

/** `63%`, `100%`, `1600%`; below one percent keeps a decimal so it never reads as zero. */
export function formatZoom(zoom: number): string {
    const percent = zoom * 100;
    return `${percent >= 1 ? Math.round(percent) : percent.toFixed(1)}%`;
}
