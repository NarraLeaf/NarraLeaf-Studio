import { describe, expect, it } from "vitest";
import { canPan, FIT_VIEW, fitZoom, formatZoom, panBy, resolveView, zoomAt, zoomTo } from "./frameViewport";

const viewport = { width: 800, height: 600 };
const hd = { width: 1920, height: 1080 };

describe("fit", () => {
    it("shows the whole frame, centred", () => {
        const view = resolveView(FIT_VIEW, viewport, hd);
        expect(view.zoom).toBeCloseTo(800 / 1920, 6);
        expect(view.x).toBeCloseTo(0, 6);
        expect(view.y).toBeCloseTo((600 - 1080 * view.zoom) / 2, 6);
    });

    it("enlarges a clip smaller than the viewport", () => {
        expect(fitZoom(viewport, { width: 320, height: 180 })).toBeCloseTo(2.5, 6);
    });

    it("does not divide by an empty viewport", () => {
        expect(fitZoom({ width: 0, height: 0 }, hd)).toBe(1);
    });
});

describe("zoom", () => {
    it("keeps the point under the pointer still", () => {
        const anchor = { x: 200, y: 300 };
        const before = resolveView(FIT_VIEW, viewport, hd);
        const pictureX = (anchor.x - before.x) / before.zoom;
        const pictureY = (anchor.y - before.y) / before.zoom;
        const after = resolveView(zoomAt(FIT_VIEW, viewport, hd, 3, anchor), viewport, hd);
        expect(anchor.x - pictureX * after.zoom).toBeCloseTo(after.x, 6);
        expect(anchor.y - pictureY * after.zoom).toBeCloseTo(after.y, 6);
    });

    it("zooms about the centre when no pointer is given", () => {
        const view = resolveView(zoomTo(FIT_VIEW, viewport, hd, 1), viewport, hd);
        expect(view.zoom).toBe(1);
        expect(view.x).toBeCloseTo((800 - 1920) / 2, 6);
        expect(view.y).toBeCloseTo((600 - 1080) / 2, 6);
    });

    it("clamps to its range", () => {
        expect(resolveView(zoomTo(FIT_VIEW, viewport, hd, 1000), viewport, hd).zoom).toBe(16);
        expect(resolveView(zoomTo(FIT_VIEW, viewport, hd, 0), viewport, hd).zoom).toBe(0.05);
    });
});

describe("pan", () => {
    it("stops at the picture's edges", () => {
        const zoomed = zoomTo(FIT_VIEW, viewport, hd, 1);
        const farLeft = resolveView(panBy(zoomed, viewport, hd, 10_000, 10_000), viewport, hd);
        expect(farLeft.x).toBe(0);
        expect(farLeft.y).toBe(0);
        const farRight = resolveView(panBy(zoomed, viewport, hd, -10_000, -10_000), viewport, hd);
        expect(farRight.x).toBe(800 - 1920);
        expect(farRight.y).toBe(600 - 1080);
    });

    it("keeps a picture smaller than the viewport centred", () => {
        const small = zoomTo(FIT_VIEW, viewport, hd, 0.25);
        const moved = resolveView(panBy(small, viewport, hd, 300, 300), viewport, hd);
        expect(moved.x).toBeCloseTo((800 - 480) / 2, 6);
        expect(canPan(small, viewport, hd)).toBe(false);
        expect(canPan(zoomTo(FIT_VIEW, viewport, hd, 1), viewport, hd)).toBe(true);
        expect(canPan(FIT_VIEW, viewport, hd)).toBe(false);
    });
});

it("formats a zoom as a percentage", () => {
    expect(formatZoom(1)).toBe("100%");
    expect(formatZoom(0.4166)).toBe("42%");
    expect(formatZoom(0.005)).toBe("0.5%");
});
