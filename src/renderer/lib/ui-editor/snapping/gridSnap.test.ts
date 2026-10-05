import { describe, expect, it } from "vitest";
import {
    DEFAULT_UI_EDITOR_GRID_SPACING,
    computeGridScreenLines,
    nearestGridPoint,
    nearestGridValue,
    normalizeUiEditorGridSpacing,
    parseUiEditorGridSpacing,
    resolveGridDisplayStep,
    resolveGridTranslate,
    snapResizeEdgeToGrid,
} from "./gridSnap";

describe("nearestGridValue", () => {
    it("rounds to the nearest multiple of the spacing", () => {
        expect(nearestGridValue(0, 20)).toBe(0);
        expect(nearestGridValue(9, 20)).toBe(0);
        expect(nearestGridValue(11, 20)).toBe(20);
        expect(nearestGridValue(146, 20)).toBe(140);
        expect(nearestGridValue(496, 20)).toBe(500);
        expect(nearestGridValue(1480, 20)).toBe(1480);
    });

    it("handles fractional positions", () => {
        expect(nearestGridValue(9.99, 20)).toBe(0);
        expect(nearestGridValue(10.01, 20)).toBe(20);
        expect(nearestGridValue(32.5, 25)).toBe(25);
        expect(nearestGridValue(37.5, 25)).toBe(50);
    });

    it("handles negative positions, and never answers -0", () => {
        expect(nearestGridValue(-13, 20)).toBe(-20);
        expect(nearestGridValue(-7, 20)).toBe(0);
        expect(Object.is(nearestGridValue(-7, 20), 0)).toBe(true);
        expect(nearestGridValue(-31, 20)).toBe(-40);
        expect(nearestGridValue(-29.5, 20)).toBe(-20);
    });

    it("breaks a tie towards positive infinity, whichever side it is approached from", () => {
        expect(nearestGridValue(10, 20)).toBe(20);
        expect(nearestGridValue(-10, 20)).toBe(0);
        expect(nearestGridValue(-30, 20)).toBe(-20);
    });

    it("snaps a point on both axes", () => {
        expect(nearestGridPoint({ x: 13, y: 27 }, 20)).toEqual({ x: 20, y: 20 });
        expect(nearestGridPoint({ x: 302, y: 403 }, 50)).toEqual({ x: 300, y: 400 });
    });
});

describe("grid spacing values", () => {
    it("accepts whole design pixels in range, rounding a fraction", () => {
        expect(normalizeUiEditorGridSpacing(20)).toBe(20);
        expect(normalizeUiEditorGridSpacing(1)).toBe(1);
        expect(normalizeUiEditorGridSpacing(1000)).toBe(1000);
        expect(normalizeUiEditorGridSpacing(12.4)).toBe(12);
    });

    it("refuses what cannot be a spacing", () => {
        for (const raw of [0, -5, 1001, Number.NaN, Number.POSITIVE_INFINITY, "20", null, undefined, {}]) {
            expect(normalizeUiEditorGridSpacing(raw)).toBeNull();
        }
    });

    it("parses what is typed into the field", () => {
        expect(parseUiEditorGridSpacing(" 50 ")).toBe(50);
        expect(parseUiEditorGridSpacing("8.6")).toBe(9);
        expect(parseUiEditorGridSpacing("")).toBeNull();
        expect(parseUiEditorGridSpacing("abc")).toBeNull();
        expect(parseUiEditorGridSpacing("0")).toBeNull();
    });

    it("defaults to 20", () => {
        expect(DEFAULT_UI_EDITOR_GRID_SPACING).toBe(20);
    });
});

describe("resolveGridTranslate", () => {
    it("puts the top-left corner on the nearest grid point when no guide caught it", () => {
        expect(resolveGridTranslate({ topLeft: { x: 146, y: 292 }, spacing: 20, guideDx: null, guideDy: null })).toEqual({
            dx: -6,
            dy: 8,
        });
    });

    it("snaps however far the corner is from a grid line - the grid is not a threshold snap", () => {
        const { dx, dy } = resolveGridTranslate({ topLeft: { x: 1024, y: 76 }, spacing: 100, guideDx: null, guideDy: null });
        expect([1024 + dx, 76 + dy]).toEqual([1000, 100]);
    });

    it("lets a guide decide its own axis and the grid the other", () => {
        expect(resolveGridTranslate({ topLeft: { x: 146, y: 292 }, spacing: 20, guideDx: 3, guideDy: null })).toEqual({
            dx: 3,
            dy: 8,
        });
        expect(resolveGridTranslate({ topLeft: { x: 146, y: 292 }, spacing: 20, guideDx: null, guideDy: 0 })).toEqual({
            dx: -6,
            dy: 0,
        });
    });

    it("works from negative and fractional corners", () => {
        const { dx, dy } = resolveGridTranslate({ topLeft: { x: -13.5, y: 0.25 }, spacing: 20, guideDx: null, guideDy: null });
        expect([-13.5 + dx, 0.25 + dy]).toEqual([-20, 0]);
    });
});

describe("snapResizeEdgeToGrid", () => {
    it("moves the dragged edge to the nearest grid line", () => {
        expect(snapResizeEdgeToGrid(237, 100, 20, 1)).toBe(240);
        expect(snapResizeEdgeToGrid(-33, 100, 20, 1)).toBe(-40);
    });

    it("steps outwards rather than collapse the box onto its anchored edge", () => {
        // Right edge dragged to 105 with the left edge at 100: the nearest line, 100, is no box at all.
        expect(snapResizeEdgeToGrid(105, 100, 20, 1)).toBe(120);
        // Left edge dragged to 95 with the right edge at 100.
        expect(snapResizeEdgeToGrid(95, 100, 20, 1)).toBe(80);
        // The anchored edge is off the grid; the nearest line is still more than a pixel away.
        expect(snapResizeEdgeToGrid(118, 113, 20, 1)).toBe(120);
    });
});

describe("resolveGridDisplayStep", () => {
    it("draws every line while cells are at least eight screen pixels", () => {
        expect(resolveGridDisplayStep(20, 1)).toBe(1);
        expect(resolveGridDisplayStep(20, 0.4)).toBe(1);
    });

    it("thins out to every 2nd, 5th, 10th... line as cells shrink", () => {
        expect(resolveGridDisplayStep(20, 0.2)).toBe(2);
        expect(resolveGridDisplayStep(20, 0.1)).toBe(5);
        expect(resolveGridDisplayStep(1, 1)).toBe(10);
        expect(resolveGridDisplayStep(1, 0.1)).toBe(100);
    });
});

describe("computeGridScreenLines", () => {
    it("draws lines over the page only, from its top-left corner", () => {
        const lines = computeGridScreenLines({
            spacing: 20,
            viewport: { scale: 1, offsetX: 10, offsetY: 5 },
            designSize: { width: 100, height: 40 },
            overlaySize: { width: 500, height: 500 },
        });
        expect(lines?.step).toBe(1);
        expect(lines?.xs).toEqual([10, 30, 50, 70, 90, 110]);
        expect(lines?.ys).toEqual([5, 25, 45]);
        expect(lines?.box).toEqual({ left: 10, top: 5, right: 110, bottom: 45 });
    });

    it("leaves out lines the overlay cannot show", () => {
        const lines = computeGridScreenLines({
            spacing: 20,
            viewport: { scale: 2, offsetX: -100, offsetY: 0 },
            designSize: { width: 1920, height: 1080 },
            overlaySize: { width: 200, height: 100 },
        });
        expect(lines?.xs[0]).toBe(-100 + 60 * 2);
        expect(lines?.xs.every(x => x >= 0 && x <= 200)).toBe(true);
        expect(lines?.ys.every(y => y >= 0 && y <= 100)).toBe(true);
    });

    it("thins out on a zoomed-out page", () => {
        const lines = computeGridScreenLines({
            spacing: 20,
            viewport: { scale: 0.2, offsetX: 0, offsetY: 0 },
            designSize: { width: 1920, height: 1080 },
            overlaySize: { width: 2000, height: 2000 },
        });
        expect(lines?.step).toBe(2);
        expect(lines?.xs.length).toBe(1920 / 40 + 1);
        expect(lines?.xs[1]).toBeCloseTo(8);
    });

    it("draws nothing when the page is out of view", () => {
        expect(
            computeGridScreenLines({
                spacing: 20,
                viewport: { scale: 1, offsetX: 600, offsetY: 0 },
                designSize: { width: 100, height: 100 },
                overlaySize: { width: 500, height: 500 },
            }),
        ).toBeNull();
    });
});
