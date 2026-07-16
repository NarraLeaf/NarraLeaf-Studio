import { WindowAppType, WindowControlPolicy } from "@shared/types/window";
import { trafficLightPositionForZoom, zoomPercentToFactor } from "@shared/constants/zoom";

/**
 * Whether a window follows the `ui.zoomPercent` setting.
 *
 * Only the Studio's own chrome does. The Dev Mode window hosts `GameApp` — the
 * player's game, rendered at the project's stage size — and zooming it would
 * make the preview stop showing what actually ships. Same reasoning as the
 * `.nl-studio` scope on the light theme (see src/renderer/styles/styles.css).
 */
export function windowTypeUsesZoom(type: WindowAppType): boolean {
    return type !== WindowAppType.DevMode;
}

/**
 * Point a webContents at the stored zoom.
 *
 * Must run after the page has loaded: Electron resets the zoom factor on every
 * navigation, so a value set before `did-finish-load` is silently dropped.
 */
export function applyZoomFactorToWebContents(webContents: Electron.WebContents, percent: unknown): void {
    webContents.setZoomFactor(zoomPercentToFactor(percent));
}

/**
 * Re-centre the macOS traffic lights for the current zoom.
 *
 * They are drawn by the OS, so `setZoomFactor` does not touch them while the CSS
 * titlebar around them grows or shrinks — left alone, they drift out of the bar.
 * Only applies to frameless windows that show native buttons; everywhere else
 * this is a no-op.
 */
export function applyTrafficLightPositionForZoom(
    browserWindow: Electron.BrowserWindow,
    controlPolicy: WindowControlPolicy,
    percent: unknown,
): void {
    if (process.platform !== "darwin" || controlPolicy === WindowControlPolicy.None) {
        return;
    }
    browserWindow.setWindowButtonPosition(trafficLightPositionForZoom(percent));
}
