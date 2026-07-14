import { describe, expect, it } from "vitest";
import {
    applyResize,
    DOCK_REGIONS,
    EDITOR_FLOOR,
    maxBottomHeight,
    maxSidebarWidth,
    RAIL_SELECTOR_WIDTH,
    resolveDock,
    TITLE_BAR_HEIGHT,
    type DockEnv,
} from "./dockLayoutModel";

const env = (overrides: Partial<DockEnv> = {}): DockEnv => ({
    windowWidth: 1600,
    windowHeight: 900,
    leftVisible: true,
    rightVisible: true,
    ...overrides,
});

describe("resolveDock", () => {
    it("returns the intended sizes unchanged when they fit", () => {
        const out = resolveDock({ left: 320, right: 320, bottom: 256 }, env());
        expect(out).toEqual({ left: 320, right: 320, bottom: 256 });
    });

    it("floors each region at its declared minimum", () => {
        const out = resolveDock({ left: 10, right: 10, bottom: 10 }, env());
        expect(out.left).toBe(DOCK_REGIONS.left.min);
        expect(out.right).toBe(DOCK_REGIONS.right.min);
        expect(out.bottom).toBe(DOCK_REGIONS.bottom.min);
    });

    it("protects the editor floor width when a sidebar is over-dragged (clamp policy)", () => {
        // Only the left sidebar visible on a narrow window.
        const e = env({ windowWidth: 1000, rightVisible: false });
        const out = resolveDock({ left: 100000, right: 320, bottom: 256 }, e);
        const editorWidth = e.windowWidth - 2 * RAIL_SELECTOR_WIDTH - out.left;
        expect(editorWidth).toBeGreaterThanOrEqual(EDITOR_FLOOR.width);
    });

    it("lets the bottom panel cover the editor entirely (clip policy)", () => {
        const e = env({ windowHeight: 900 });
        const out = resolveDock({ left: 320, right: 320, bottom: 100000 }, e);
        // May consume the whole center column, leaving the editor 0px — only the title bar is reserved.
        expect(out.bottom).toBe(e.windowHeight - TITLE_BAR_HEIGHT);
        expect(out.bottom).toBeGreaterThan(600); // far past the old 600px / half-height cap
    });

    it("subtracts a visible right sidebar from the left sidebar's ceiling", () => {
        const e = env({ windowWidth: 1200 });
        const wide = resolveDock({ left: 100000, right: 300, bottom: 256 }, e);
        const narrow = resolveDock({ left: 100000, right: 500, bottom: 256 }, e);
        // A wider right sidebar leaves less room for the left one.
        expect(narrow.left).toBeLessThan(wide.left);
    });

    it("does not mutate intent: effective grows back when the window grows", () => {
        const intent = { left: 700, right: 320, bottom: 256 };
        const small = resolveDock(intent, env({ windowWidth: 900, rightVisible: false }));
        const large = resolveDock(intent, env({ windowWidth: 2400, rightVisible: false }));
        expect(small.left).toBeLessThan(700); // clamped down on the small window
        expect(large.left).toBe(700); // restored on the large window (intent never mutated)
    });
});

describe("maxSidebarWidth / maxBottomHeight", () => {
    it("never returns below the region minimum, even on a tiny window", () => {
        const e = env({ windowWidth: 200, windowHeight: 100 });
        expect(maxSidebarWidth("left", e, 0)).toBe(DOCK_REGIONS.left.min);
        expect(maxBottomHeight(e)).toBe(DOCK_REGIONS.bottom.min);
    });
});

describe("applyResize", () => {
    it("grows the left sidebar as the pointer moves right (+delta)", () => {
        const { next } = applyResize("left", 320, 40, env(), 320);
        expect(next).toBe(360);
    });

    it("grows the right sidebar / bottom panel as the pointer moves left/up (-delta)", () => {
        expect(applyResize("right", 320, -40, env(), 320).next).toBe(360);
        expect(applyResize("bottom", 256, -40, env(), 0).next).toBe(296);
    });

    it("stalls at the minimum and reports a correction so the handle edge stays with the size", () => {
        // Drag left sidebar far below its min: size pins to min, correction cancels the unused delta.
        const { next, correction } = applyResize("left", DOCK_REGIONS.left.min, -200, env(), 320);
        expect(next).toBe(DOCK_REGIONS.left.min);
        // sign(+1) * actualDelta(0) - delta(-200) = 200 — feeds back the fully-unused pointer travel.
        expect(correction).toBe(200);
    });

    it("returns zero correction while the size tracks the pointer 1:1", () => {
        const { correction } = applyResize("left", 320, 40, env(), 320);
        expect(correction).toBe(0);
    });
});
