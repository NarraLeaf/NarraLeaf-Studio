import fsSync from "fs";
import path from "path";
import {
    WINDOW_SCALE_DESIGN,
    WINDOW_SCALE_STEPS,
    type WindowConfiguration,
    type WindowScaleStep,
} from "@shared/types/appWindow";
import {
    MIN_WINDOW_CONTENT,
    fitInside,
    roomForStage,
    scaledDesign,
    type WindowBox,
    type WindowChrome,
    type WorkArea,
} from "@shared/utils/windowGeometry";

/**
 * The stage arithmetic, re-exported because it moved rather than changed.
 *
 * It lives in `@shared` now: Studio's Dev Mode window sizes its stage with the same numbers this
 * shell sizes a game window with, and two copies of that would be two answers to "what is 75%".
 */
export {
    MIN_WINDOW_CONTENT,
    NO_WINDOW_CHROME,
    currentWindowScale,
    fitInside,
    fittingWindowScales,
    roomForStage,
    scaledDesign,
    type WindowBox,
    type WindowChrome,
    type WorkArea,
} from "@shared/utils/windowGeometry";

/**
 * The window a shipped game opens, and the one it reopens.
 *
 * Three faults lived here, and they share a cause - the shell handed the entry surface's design
 * size straight to Electron and asked the screen nothing:
 *
 *  - **Electron's `width`/`height` are the OUTER size.** A 1920x1080 project therefore got a
 *    client area a title bar shorter than 1080, so the stage was scaled to about 0.97 and the art
 *    was never seen at the size it was drawn. That is the default combination for this product -
 *    the standard project size on the most common display - not an edge case. The fix is
 *    `useContentSize`, which makes the design size mean the stage.
 *  - **Nothing was measured.** A 1080-tall window plus a title bar does not fit a 1080p desktop
 *    once the taskbar has taken its strip, so the first launch put part of the window off-screen,
 *    and a small laptop or a high-DPI screen got the same numbers regardless.
 *  - **Nothing was remembered.** Every launch went back to the design size in a window, and the
 *    author could not compensate: the host API has no way to size a window, so the size row of a
 *    configuration screen was not something a game could contain.
 *
 * The decisions are here, as arithmetic over plain records, because the alternative is that
 * "what window does a 1080p game open on a 1366x768 laptop" can only be answered by owning that
 * laptop. `main.ts` supplies the screen's own numbers and applies the answer.
 */

/**
 * The window as it was last closed.
 *
 * The size is the CONTENT size, like everything else here: an outer size would be a different
 * amount of stage on a platform whose window frame differs from the one that wrote it.
 */
export type WindowGeometryRecord = {
    width: number;
    height: number;
    /**
     * The WINDOW's top-left, not the stage's, and null when there was no meaningful position to
     * keep - maximised, or full-screen.
     *
     * The size above is the content and this is not, which is deliberate rather than sloppy: both
     * are what Electron takes back. Reading the position off the content instead moves the window
     * down by the height of its own title bar on every relaunch.
     */
    x: number | null;
    y: number | null;
    maximized: boolean;
    fullscreen: boolean;
};

export const WINDOW_GEOMETRY_FILE_NAME = "window.json";

/**
 * How much of a remembered window has to land on a display for the position to be worth keeping.
 *
 * A window whose title bar is off every screen cannot be moved back by the player, so a remembered
 * position that no longer lands anywhere - the laptop is off its dock, the second monitor is gone -
 * is dropped in favour of centring rather than restored faithfully.
 */
const MIN_VISIBLE_OVERLAP: WindowBox = { width: 120, height: 48 };

/**
 * The size to open at on a screen this game has never been opened on.
 *
 * The largest step that fits and does not enlarge the art: a game opens at the size it was drawn
 * at, or at the largest whole fraction of it the screen has room for. Upscaling is something a
 * player asks for, never something a first launch decides.
 */
export function pickInitialScale(
    design: WindowBox,
    steps: readonly WindowScaleStep[],
    workArea: WindowBox,
): WindowScaleStep {
    const offered = steps.length > 0 ? [...steps].sort((a, b) => a - b) : [WINDOW_SCALE_DESIGN];
    let chosen: WindowScaleStep | null = null;
    for (const step of offered) {
        if (design.width * step <= workArea.width && design.height * step <= workArea.height) {
            chosen = step;
        }
    }
    return chosen ?? offered[0]!;
}

/** The steps a first launch may choose between: the design size and the fractions below it. */
export const WINDOW_LAUNCH_SCALE_STEPS: readonly WindowScaleStep[] =
    WINDOW_SCALE_STEPS.filter(step => step <= WINDOW_SCALE_DESIGN);

/** Whether a window at this rectangle would still be reachable on one of these displays. */
export function isOnADisplay(
    rect: { x: number; y: number; width: number; height: number },
    displays: readonly WorkArea[],
): boolean {
    return displays.some(area => {
        const overlapX = Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x);
        const overlapY = Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y);
        return overlapX >= MIN_VISIBLE_OVERLAP.width && overlapY >= MIN_VISIBLE_OVERLAP.height;
    });
}

export type ResolvedWindowGeometry = {
    /** Content size, for `useContentSize`. */
    width: number;
    height: number;
    /** Absent means centre on the current display, which is what a first launch wants. */
    x?: number;
    y?: number;
    maximized: boolean;
    fullscreen: boolean;
};

export function resolveWindowGeometry(input: {
    /** The entry surface's design size: what the stage is drawn at. */
    design: WindowBox;
    config: WindowConfiguration;
    /** What the last session wrote, or null on a first launch and when the author turned it off. */
    remembered: WindowGeometryRecord | null;
    /** Where the window would go: the display holding the remembered position, or the primary one. */
    workArea: WorkArea;
    /** Every display's work area, for deciding whether a remembered position still exists. */
    displays: readonly WorkArea[];
    /**
     * What the window's frame adds to the stage. Zero on the first pass, where there is no window
     * to measure yet; see {@link WindowChrome} and `main.ts`, which measures and asks again.
     */
    chrome?: WindowChrome;
}): ResolvedWindowGeometry {
    const remembered = input.config.rememberGeometry ? input.remembered : null;
    const room = roomForStage(input.workArea, input.chrome);
    const base = remembered
        ? { width: remembered.width, height: remembered.height }
        : scaledDesign(input.design, pickInitialScale(input.design, WINDOW_LAUNCH_SCALE_STEPS, room));
    const size = fitInside(base, room);
    const geometry: ResolvedWindowGeometry = {
        ...size,
        maximized: remembered?.maximized === true,
        // The author's answer decides the first launch; after that the player's own last answer
        // does, because leaving full screen is something they did on purpose.
        fullscreen: remembered ? remembered.fullscreen : input.config.startFullscreen,
    };
    if (remembered && remembered.x !== null && remembered.y !== null) {
        const rect = { x: remembered.x, y: remembered.y, ...size };
        if (isOnADisplay(rect, input.displays)) {
            geometry.x = rect.x;
            geometry.y = rect.y;
        }
    }
    return geometry;
}

export function normalizeWindowGeometryRecord(value: unknown): WindowGeometryRecord | null {
    const record = (value && typeof value === "object" ? value : null) as Record<string, unknown> | null;
    if (!record) {
        return null;
    }
    const width = finite(record.width);
    const height = finite(record.height);
    if (width === null || height === null || width < MIN_WINDOW_CONTENT.width || height < MIN_WINDOW_CONTENT.height) {
        // A file that cannot say how big the window was says nothing at all: a position and a
        // screen mode on their own would open a window of some other size in a remembered place.
        return null;
    }
    return {
        width: Math.round(width),
        height: Math.round(height),
        x: integerOrNull(record.x),
        y: integerOrNull(record.y),
        maximized: record.maximized === true,
        fullscreen: record.fullscreen === true,
    };
}

/** What the last session left, or null - no file, an unreadable one, or one that says nothing usable. */
export function readWindowGeometry(userDataDir: string): WindowGeometryRecord | null {
    try {
        const raw = fsSync.readFileSync(windowGeometryPath(userDataDir), "utf-8");
        return normalizeWindowGeometryRecord(JSON.parse(raw));
    } catch {
        // A first launch, a profile the player deleted, a half-written file. All of them mean the
        // same thing to the window: open where a first launch would.
        return null;
    }
}

/**
 * Write the geometry, synchronously.
 *
 * The moment worth recording is the window closing, which is also the last moment this process has:
 * an asynchronous write issued there is one the quit does not wait for.
 *
 * ## Why this does not write through a temporary file
 *
 * It did, and on an ordinary Windows profile it never worked: MEASURED on a packaged game, the
 * rename of `window.json.tmp` onto `window.json` - two names in the same directory - failed with
 * `EXDEV: cross-device link not permitted`, because `%APPDATA%` there is a redirected folder and
 * the filter driver behind it refuses the operation. The file simply never appeared, and every
 * launch opened as if it were the first.
 *
 * Writing straight to the file costs the atomicity the rename was for, and that costs nothing
 * here: the payload is under a hundred bytes, and a torn one is refused by
 * {@link normalizeWindowGeometryRecord} - which reads as "nothing remembered", the same state a
 * first launch is in. A guarantee that does not survive contact with the platform is worth less
 * than a write that lands.
 */
export function writeWindowGeometry(
    userDataDir: string,
    record: WindowGeometryRecord,
    log?: (message: string) => void,
): void {
    const target = windowGeometryPath(userDataDir);
    try {
        fsSync.mkdirSync(path.dirname(target), { recursive: true });
        fsSync.writeFileSync(target, JSON.stringify(record), "utf-8");
    } catch (error) {
        // Where the window was is worth nothing against failing to close, so this degrades to
        // "next launch opens like a first one" rather than throwing on the way out.
        //
        // It says so, though. Swallowing the reason is what made the EXDEV above take a packaged
        // run to find: a window that quietly stops being remembered looks exactly like a feature
        // that was never built.
        log?.(`could not remember the window: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function windowGeometryPath(userDataDir: string): string {
    return path.join(userDataDir, WINDOW_GEOMETRY_FILE_NAME);
}

function finite(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerOrNull(value: unknown): number | null {
    const number = finite(value);
    return number === null ? null : Math.round(number);
}
