import { describe, expect, it } from "vitest";
import { clampView, ensureVisible, fitAll, scrollByFraction, zoomAt, zoomToRange } from "./viewWindow";

const TOTAL = 10_000;

describe("clampView", () => {
    it("keeps the window inside the clip", () => {
        expect(clampView({ start: -500, end: 500 }, TOTAL)).toEqual({ start: 0, end: 1000 });
        expect(clampView({ start: 9500, end: 10_500 }, TOTAL)).toEqual({ start: 9000, end: 10_000 });
    });

    it("refuses to collapse below the minimum span", () => {
        const view = clampView({ start: 100, end: 101 }, TOTAL);
        expect(view.end - view.start).toBe(64);
    });

    it("never shows more than the clip", () => {
        expect(clampView({ start: 0, end: 99_999 }, TOTAL)).toEqual({ start: 0, end: TOTAL });
    });
});

describe("zoomAt", () => {
    it("halves the span when zooming in", () => {
        const view = zoomAt(fitAll(TOTAL), TOTAL, 2, 5000);
        expect(view.end - view.start).toBe(5000);
    });

    it("keeps the anchor sample at the same relative position", () => {
        const before = { start: 0, end: 10_000 };
        const anchor = 2500; // a quarter in
        const after = zoomAt(before, TOTAL, 2, anchor);
        const ratio = (anchor - after.start) / (after.end - after.start);
        expect(ratio).toBeCloseTo(0.25, 5);
    });

    it("clamps rather than running past the start when the anchor is at the edge", () => {
        const view = zoomAt({ start: 0, end: 1000 }, TOTAL, 2, 0);
        expect(view.start).toBe(0);
        expect(view.end).toBe(500);
    });

    it("zooming out past the clip settles on the whole clip", () => {
        expect(zoomAt({ start: 4000, end: 5000 }, TOTAL, 0.01, 4500)).toEqual({ start: 0, end: TOTAL });
    });
});

describe("scrollByFraction", () => {
    it("moves by a fraction of the visible span", () => {
        expect(scrollByFraction({ start: 1000, end: 2000 }, TOTAL, 0.5)).toEqual({ start: 1500, end: 2500 });
    });

    it("stops at the ends instead of scrolling into nothing", () => {
        expect(scrollByFraction({ start: 9500, end: 10_000 }, TOTAL, 1)).toEqual({ start: 9500, end: 10_000 });
        expect(scrollByFraction({ start: 0, end: 500 }, TOTAL, -1)).toEqual({ start: 0, end: 500 });
    });
});

describe("zoomToRange", () => {
    it("frames the range with padding on both sides", () => {
        const view = zoomToRange({ start: 4000, end: 5000 }, TOTAL);
        expect(view.start).toBeLessThan(4000);
        expect(view.end).toBeGreaterThan(5000);
    });
});

describe("ensureVisible", () => {
    it("leaves a window that already contains the sample alone", () => {
        const view = { start: 1000, end: 2000 };
        expect(ensureVisible(view, TOTAL, 1500)).toBe(view);
    });

    it("pages forward when the playhead runs off the right edge", () => {
        const view = ensureVisible({ start: 1000, end: 2000 }, TOTAL, 2100);
        expect(2100).toBeGreaterThanOrEqual(view.start);
        expect(2100).toBeLessThan(view.end);
    });
});
