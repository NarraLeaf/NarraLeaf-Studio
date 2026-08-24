import fsSync from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_WINDOW_CONFIGURATION, type WindowConfiguration } from "@shared/types/appWindow";
import {
    currentWindowScale,
    fitInside,
    roomForStage,
    isOnADisplay,
    normalizeWindowGeometryRecord,
    pickInitialScale,
    readWindowGeometry,
    resolveWindowGeometry,
    windowGeometryPath,
    writeWindowGeometry,
    type WindowGeometryRecord,
} from "./windowGeometry";

/** The combination this whole module exists for: the standard project size on the usual display. */
const DESIGN = { width: 1920, height: 1080 };
/** 1080p with a Windows taskbar taken off the bottom. */
const DESKTOP_1080P = { x: 0, y: 0, width: 1920, height: 1032 };
/** The screen a 1080p project used to open half off. */
const LAPTOP_768 = { x: 0, y: 0, width: 1366, height: 728 };

function config(overrides: Partial<WindowConfiguration> = {}): WindowConfiguration {
    return { ...DEFAULT_WINDOW_CONFIGURATION, ...overrides };
}

describe("pickInitialScale", () => {
    it("opens a 1080p project at its design size on a screen with room for it", () => {
        expect(pickInitialScale(DESIGN, [0.5, 0.75, 1], { width: 2560, height: 1400 })).toBe(1);
    });

    it("steps down rather than hang off a 1080p desktop", () => {
        // 1920x1080 does not fit under a taskbar; 0.75 of it does.
        expect(pickInitialScale(DESIGN, [0.5, 0.75, 1], DESKTOP_1080P)).toBe(0.75);
    });

    it("steps down again on a small laptop", () => {
        expect(pickInitialScale(DESIGN, [0.5, 0.75, 1], LAPTOP_768)).toBe(0.5);
    });

    it("takes the smallest offered step when none of them fit", () => {
        expect(pickInitialScale(DESIGN, [1, 1.5], LAPTOP_768)).toBe(1);
    });
});

describe("fitInside", () => {
    it("leaves a box that fits alone", () => {
        expect(fitInside({ width: 1280, height: 720 }, DESKTOP_1080P)).toEqual({ width: 1280, height: 720 });
    });

    it("keeps the aspect ratio of what it shrinks", () => {
        const fitted = fitInside(DESIGN, LAPTOP_768);
        expect(fitted.width / fitted.height).toBeCloseTo(16 / 9, 2);
        expect(fitted.width).toBeLessThanOrEqual(LAPTOP_768.width);
        expect(fitted.height).toBeLessThanOrEqual(LAPTOP_768.height);
    });

    it("never shrinks below the window minimum", () => {
        expect(fitInside(DESIGN, { width: 200, height: 100 })).toEqual({ width: 480, height: 320 });
    });
});

describe("resolveWindowGeometry", () => {
    const displays = [DESKTOP_1080P];

    it("centres a first launch at a size that fits", () => {
        const geometry = resolveWindowGeometry({
            design: DESIGN,
            config: config(),
            remembered: null,
            workArea: DESKTOP_1080P,
            displays,
        });
        expect(geometry).toEqual({ width: 1440, height: 810, maximized: false, fullscreen: false });
        expect(geometry.x).toBeUndefined();
    });

    it("opens full-screen when the author said so, and only on a first launch", () => {
        expect(resolveWindowGeometry({
            design: DESIGN,
            config: config({ startFullscreen: true }),
            remembered: null,
            workArea: DESKTOP_1080P,
            displays,
        }).fullscreen).toBe(true);

        expect(resolveWindowGeometry({
            design: DESIGN,
            config: config({ startFullscreen: true }),
            remembered: { width: 1280, height: 720, x: 10, y: 10, maximized: false, fullscreen: false },
            workArea: DESKTOP_1080P,
            displays,
        }).fullscreen).toBe(false);
    });

    it("comes back where the player left it", () => {
        expect(resolveWindowGeometry({
            design: DESIGN,
            config: config(),
            remembered: { width: 1280, height: 720, x: 300, y: 120, maximized: false, fullscreen: false },
            workArea: DESKTOP_1080P,
            displays,
        })).toEqual({ width: 1280, height: 720, x: 300, y: 120, maximized: false, fullscreen: false });
    });

    it("drops a position on a screen that is no longer there", () => {
        const geometry = resolveWindowGeometry({
            design: DESIGN,
            config: config(),
            remembered: { width: 1280, height: 720, x: 2600, y: 200, maximized: false, fullscreen: false },
            workArea: DESKTOP_1080P,
            displays,
        });
        expect(geometry.x).toBeUndefined();
        expect(geometry.y).toBeUndefined();
        expect(geometry.width).toBe(1280);
    });

    it("fits a remembered size onto a smaller screen", () => {
        const geometry = resolveWindowGeometry({
            design: DESIGN,
            config: config(),
            remembered: { width: 1920, height: 1080, x: null, y: null, maximized: false, fullscreen: false },
            workArea: LAPTOP_768,
            displays: [LAPTOP_768],
        });
        expect(geometry.width).toBeLessThanOrEqual(LAPTOP_768.width);
        expect(geometry.height).toBeLessThanOrEqual(LAPTOP_768.height);
    });

    it("ignores what was remembered when the author turned remembering off", () => {
        const geometry = resolveWindowGeometry({
            design: DESIGN,
            config: config({ rememberGeometry: false }),
            remembered: { width: 960, height: 540, x: 40, y: 40, maximized: true, fullscreen: true },
            workArea: DESKTOP_1080P,
            displays,
        });
        expect(geometry).toEqual({ width: 1440, height: 810, maximized: false, fullscreen: false });
    });
});

/** Measured on Windows 11 at 125% scaling; the module's own doc-comment names the same numbers. */
const WINDOWS_CHROME = { width: 15, height: 64 };

describe("the window's own frame", () => {
    it("takes its share of the display before anything is decided", () => {
        expect(roomForStage(DESKTOP_1080P, WINDOWS_CHROME)).toEqual({ width: 1905, height: 968 });
    });

    it("never leaves less than a window", () => {
        expect(roomForStage({ width: 200, height: 100 }, WINDOWS_CHROME))
            .toEqual({ width: 480, height: 320 });
    });

    it("steps a 1080p project down on a 1080p desktop, where the frame is what does not fit", () => {
        // 1080 rows of stage plus 64 of frame is 1144, and the desktop has 1032 under its taskbar.
        // Without the frame this reads as a fit, and the platform silently clips the window.
        const room = roomForStage(DESKTOP_1080P, WINDOWS_CHROME);
        expect(pickInitialScale(DESIGN, [0.5, 0.75, 1], room)).toBe(0.75);
    });

    it("opens the whole design size on a display with room for the frame as well", () => {
        const room = roomForStage({ width: 2560, height: 1400 }, WINDOWS_CHROME);
        expect(pickInitialScale(DESIGN, [0.5, 0.75, 1], room)).toBe(1);
    });

    it("is carried through the resolver", () => {
        const geometry = resolveWindowGeometry({
            design: DESIGN,
            config: config(),
            remembered: null,
            workArea: DESKTOP_1080P,
            displays: [DESKTOP_1080P],
            chrome: WINDOWS_CHROME,
        });
        expect(geometry.width + WINDOWS_CHROME.width).toBeLessThanOrEqual(DESKTOP_1080P.width);
        expect(geometry.height + WINDOWS_CHROME.height).toBeLessThanOrEqual(DESKTOP_1080P.height);
        expect(geometry.width / DESIGN.width).toBe(0.75);
    });
});

describe("isOnADisplay", () => {
    it("accepts a window hanging off an edge but still grabbable", () => {
        expect(isOnADisplay({ x: -200, y: 0, width: 1280, height: 720 }, [DESKTOP_1080P])).toBe(true);
    });

    it("refuses one that is entirely past every display", () => {
        expect(isOnADisplay({ x: 3000, y: 0, width: 1280, height: 720 }, [DESKTOP_1080P])).toBe(false);
        expect(isOnADisplay({ x: 100, y: -700, width: 1280, height: 720 }, [DESKTOP_1080P])).toBe(false);
    });

    it("accepts one on the second monitor", () => {
        const second = { x: 1920, y: 0, width: 1920, height: 1032 };
        expect(isOnADisplay({ x: 2100, y: 100, width: 1280, height: 720 }, [DESKTOP_1080P, second])).toBe(true);
    });
});

describe("currentWindowScale", () => {
    it("reads the step a window is at", () => {
        expect(currentWindowScale(DESIGN, { width: 1440, height: 810 }, [0.5, 0.75, 1])).toBe(0.75);
        expect(currentWindowScale(DESIGN, { width: 1920, height: 1080 }, [0.5, 0.75, 1])).toBe(1);
    });

    it("answers a dragged window with the nearest offered step", () => {
        expect(currentWindowScale(DESIGN, { width: 1500, height: 844 }, [0.5, 0.75, 1])).toBe(0.75);
    });
});

describe("the geometry file", () => {
    let dir: string;

    beforeEach(() => {
        dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "nls-window-"));
    });

    afterEach(() => {
        fsSync.rmSync(dir, { recursive: true, force: true });
    });

    it("reads back what it wrote", () => {
        const record: WindowGeometryRecord = {
            width: 1280, height: 720, x: 40, y: 60, maximized: false, fullscreen: true,
        };
        writeWindowGeometry(dir, record);
        expect(readWindowGeometry(dir)).toEqual(record);
    });

    it("says nothing on a first launch", () => {
        expect(readWindowGeometry(dir)).toBeNull();
    });

    it("says nothing rather than half of an answer", () => {
        fsSync.writeFileSync(windowGeometryPath(dir), "{ not json", "utf-8");
        expect(readWindowGeometry(dir)).toBeNull();

        fsSync.writeFileSync(windowGeometryPath(dir), JSON.stringify({ x: 10, y: 10, fullscreen: true }), "utf-8");
        expect(readWindowGeometry(dir)).toBeNull();
    });

    it("refuses a size below the window minimum", () => {
        expect(normalizeWindowGeometryRecord({ width: 100, height: 60 })).toBeNull();
    });

    it("leaves no temporary file behind", () => {
        writeWindowGeometry(dir, { width: 800, height: 450, x: null, y: null, maximized: true, fullscreen: false });
        expect(fsSync.readdirSync(dir)).toEqual(["window.json"]);
    });
});
