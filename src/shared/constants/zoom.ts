/**
 * Studio UI zoom, stored as a whole percentage under the `ui.zoomPercent`
 * global-state key and applied to each window's webContents by the main process
 * (see src/main/app/application/zoom.ts).
 *
 * Shared rather than renderer-local because both sides need the same ladder:
 * the Settings window validates against the range, and the main process steps
 * through it for the zoom keyboard shortcuts.
 */

export const ZOOM_PERCENT_DEFAULT = 100;
export const ZOOM_PERCENT_MIN = 50;
export const ZOOM_PERCENT_MAX = 200;

/** The steps Cmd/Ctrl +/- walk through — the ladder browsers have trained everyone on. */
export const ZOOM_PERCENT_STEPS: readonly number[] = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];

/** Clamp anything (stale config, a hand-typed setting) onto a usable whole percentage. */
export function normalizeZoomPercent(value: unknown): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return ZOOM_PERCENT_DEFAULT;
    }
    return Math.min(ZOOM_PERCENT_MAX, Math.max(ZOOM_PERCENT_MIN, Math.round(parsed)));
}

/**
 * The next ladder step above (`direction: 1`) or below (`direction: -1`) the
 * current zoom. Works from off-ladder values too — a hand-typed 137% steps up to
 * 150% and down to 125% — so the shortcuts stay predictable after someone edits
 * the setting directly. Returns the current value unchanged at either end.
 */
export function nextZoomPercent(current: unknown, direction: 1 | -1): number {
    const from = normalizeZoomPercent(current);
    const candidates = direction === 1
        ? ZOOM_PERCENT_STEPS.filter(step => step > from)
        : ZOOM_PERCENT_STEPS.filter(step => step < from);
    if (candidates.length === 0) {
        return from;
    }
    return direction === 1 ? candidates[0] : candidates[candidates.length - 1];
}

/** webContents.setZoomFactor takes a multiplier, not a percentage. */
export function zoomPercentToFactor(percent: unknown): number {
    return normalizeZoomPercent(percent) / 100;
}

/**
 * Titlebar height in CSS pixels — mirrors `--nl-window-titlebar-height` in
 * styles.css and the `h-10` on the TitleBar component. Zoom multiplies it, which
 * is why the macOS traffic lights (which do NOT scale — they are drawn by the OS)
 * have to be repositioned whenever the zoom changes.
 */
export const TITLEBAR_HEIGHT_CSS_PX = 40;

/** Roughly what one traffic light occupies vertically, including its focus ring. */
const TRAFFIC_LIGHT_HEIGHT_PX = 16;

/** Left inset of the traffic lights, in device pixels — constant, as on native macOS windows. */
const TRAFFIC_LIGHT_INSET_X_PX = 14;

/**
 * Where to put the macOS traffic lights so they stay vertically centred in a
 * titlebar whose height scales with `ui.zoomPercent`.
 *
 * The lights are a fixed physical size no matter the zoom, so only their offset
 * can compensate. At 100% this returns `{x: 14, y: 12}` — the value the windows
 * were hard-coded to before zoom existed, so the default look is unchanged.
 */
export function trafficLightPositionForZoom(percent: unknown): { x: number; y: number } {
    const zoom = zoomPercentToFactor(percent);
    const titlebarDeviceHeight = TITLEBAR_HEIGHT_CSS_PX * zoom;
    return {
        x: TRAFFIC_LIGHT_INSET_X_PX,
        y: Math.max(0, Math.round((titlebarDeviceHeight - TRAFFIC_LIGHT_HEIGHT_PX) / 2)),
    };
}
