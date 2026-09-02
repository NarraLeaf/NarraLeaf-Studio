/**
 * The arithmetic that decides how big a stage is, and what sizes a screen has room to offer.
 *
 * Plain records and numbers, with nothing of Electron in it, because two processes need the same
 * answers: a packaged game's shell sizes its window from here, and Studio's Dev Mode window sizes
 * the stage inside its own frame from here. The alternative is two copies of "what does 75% mean",
 * and the moment they differ is the moment "it looked right in Dev Mode" stops being worth
 * anything.
 *
 * The rest of a shipped window's geometry - what a first launch picks, what the last session left
 * on disk - stays with the shell that owns a window (`src/runtime/main/windowGeometry.ts`).
 */

import {
    nearestWindowScaleStep,
    WINDOW_SCALE_DESIGN,
    WINDOW_SCALE_STEPS,
    type WindowScaleStep,
} from "../types/appWindow";

export type WindowBox = { width: number; height: number };

/** A display's usable area, as Electron reports it: the desktop minus taskbars and docks. */
export type WorkArea = { x: number; y: number; width: number; height: number };

/** The floor the window may not be fitted below; mirrors the `BrowserWindow` minimum. */
export const MIN_WINDOW_CONTENT: WindowBox = { width: 480, height: 320 };

/** Scale a box down until it fits, keeping its own aspect ratio. Never up, never below the floor. */
export function fitInside(box: WindowBox, workArea: WindowBox): WindowBox {
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    const room = Math.min(workArea.width / width, workArea.height / height, 1);
    if (room >= 1) {
        return { width, height };
    }
    return {
        width: Math.max(MIN_WINDOW_CONTENT.width, Math.floor(width * room)),
        height: Math.max(MIN_WINDOW_CONTENT.height, Math.floor(height * room)),
    };
}

/**
 * The steps that fit, for a configuration screen to offer.
 *
 * Answered against the player's own display rather than declared by the project, which cannot know
 * what screen the game will be played on: 200% is the right offer on a 4K monitor and nonsense on a
 * laptop, and a list that offered it anyway would be a row of sizes that do nothing.
 */
export function fittingWindowScales(design: WindowBox, room: WindowBox): WindowScaleStep[] {
    const fitting = WINDOW_SCALE_STEPS.filter(step => (
        design.width * step <= room.width && design.height * step <= room.height
    ));
    // Never nothing: a screen too small for even the smallest step still has a window on it, and a
    // configuration screen with an empty list would look like the feature is missing rather than
    // like the display is small.
    return fitting.length > 0 ? [...fitting] : [WINDOW_SCALE_STEPS[0]!];
}

/**
 * How much bigger the window is than the stage inside it: title bar, borders, and whatever the
 * platform's theme adds.
 *
 * Only a real window can answer, and the answer is not small - MEASURED at 15x64 on Windows 11 at
 * 125% scaling. It has to be subtracted before deciding anything, because what must fit the screen
 * is the window and what the author sized is the stage: a 1080-tall stage on a 1080p desktop needs
 * 1144 rows once the frame is counted, which is more than the desktop has under a taskbar. Without
 * this the platform silently clips the window to the screen, and the stage lands on whatever is
 * left - measured at 1920x1067, a size no scale step names.
 */
export type WindowChrome = WindowBox;

export const NO_WINDOW_CHROME: WindowChrome = { width: 0, height: 0 };

/** What is left of a display for the stage once the window's own frame has taken its share. */
export function roomForStage(workArea: WindowBox, chrome: WindowChrome = NO_WINDOW_CHROME): WindowBox {
    return {
        width: Math.max(MIN_WINDOW_CONTENT.width, workArea.width - chrome.width),
        height: Math.max(MIN_WINDOW_CONTENT.height, workArea.height - chrome.height),
    };
}

/** The content box a scale step asks for. */
export function scaledDesign(design: WindowBox, scale: number): WindowBox {
    return {
        width: Math.round(design.width * scale),
        height: Math.round(design.height * scale),
    };
}

/**
 * Which offered step a window is currently at, for the configuration screen's own reading.
 *
 * Answered against the width alone: the aspect ratio is held by the window itself, and a height
 * rounded by the platform's frame arithmetic would otherwise make an exact step read as a near one.
 */
export function currentWindowScale(
    design: WindowBox,
    content: WindowBox,
    steps: readonly WindowScaleStep[] = WINDOW_SCALE_STEPS,
): WindowScaleStep {
    if (design.width <= 0) {
        return WINDOW_SCALE_DESIGN;
    }
    return nearestWindowScaleStep(content.width / design.width, steps);
}
