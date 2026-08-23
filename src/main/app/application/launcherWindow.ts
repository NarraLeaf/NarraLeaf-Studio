import { BrowserWindow } from "electron";

/**
 * The launcher window's two sizes, and the one way to move between them.
 *
 * The home screen is a fixed 800x500 and has been since it was drawn: a navigation column, a list,
 * and nothing that grows. First-run setup is the one thing that window ever hosts which is not that
 * screen - it asks a question on the left and shows what the answer does on the right - and two
 * panes do not fit in 800, least of all once the author has raised `ui.zoomPercent` and every CSS
 * pixel costs more than one device pixel.
 *
 * So setup opens the window bigger and hands it back at its own size when it ends. Deliberately not
 * "make the launcher resizable": the home screen's layout is written against a fixed box, and a
 * window an author can drag to 2000x400 is a layout question nobody has answered.
 */
export interface LauncherWindowSize {
    width: number;
    height: number;
}

/** The home screen, unchanged. */
export const LAUNCHER_HOME_SIZE: LauncherWindowSize = { width: 800, height: 500 };

/**
 * First-run setup.
 *
 * Sized so the two-pane layout still holds at 150% zoom (667x427 CSS pixels), which is the top of
 * the range anybody drives an interface at day to day. Above that the flow drops the preview pane
 * and reads as one column - see `OnboardingFlow`.
 */
export const LAUNCHER_ONBOARDING_SIZE: LauncherWindowSize = { width: 1000, height: 640 };

/**
 * Put a launcher window at one of the two sizes, pinned there and re-centred.
 *
 * The pin is min == max == the size, which is what makes the window unresizable in the first place;
 * `setSize` alone would be clamped by whichever pair is still in force. `setResizable` is lifted for
 * the duration because a window that cannot be resized cannot be resized by us either.
 */
export function applyLauncherWindowSize(window: BrowserWindow, size: LauncherWindowSize): void {
    if (window.isDestroyed()) {
        return;
    }
    const [currentWidth, currentHeight] = window.getSize();
    if (currentWidth === size.width && currentHeight === size.height) {
        return;
    }
    const wasResizable = window.isResizable();
    window.setResizable(true);
    // Widened before narrowed, in both directions: a maximum still holding at the old size would
    // clamp a growth, and a minimum still holding would clamp a shrink.
    window.setMinimumSize(Math.min(currentWidth, size.width), Math.min(currentHeight, size.height));
    window.setMaximumSize(Math.max(currentWidth, size.width), Math.max(currentHeight, size.height));
    window.setSize(size.width, size.height);
    window.setMinimumSize(size.width, size.height);
    window.setMaximumSize(size.width, size.height);
    window.center();
    window.setResizable(wasResizable);
}
