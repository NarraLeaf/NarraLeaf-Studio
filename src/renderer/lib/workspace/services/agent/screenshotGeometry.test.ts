import { describe, expect, it } from "vitest";
import { SCREENSHOT_MAX_UPSCALE, designRectFromClientRects, drawnBounds, fitWithin, planScreenshot } from "./screenshotGeometry";

/** Which part of a page an agent's screenshot shows, and at what size. */
describe("planScreenshot", () => {
    const design = { width: 1920, height: 1080 };

    it("draws a whole page with its longer edge at most maxSize, never enlarged", () => {
        expect(planScreenshot(design, null, 1280)).toEqual({ source: { x: 0, y: 0, width: 1920, height: 1080 }, scale: 1280 / 1920, width: 1280, height: 720 });
        expect(planScreenshot({ width: 640, height: 360 }, null, 1280)?.scale).toBe(1);
    });

    it("enlarges a small crop, up to the limit", () => {
        const plan = planScreenshot(design, { x: 100, y: 200, width: 200, height: 50 }, 1280)!;
        expect(plan.scale).toBe(SCREENSHOT_MAX_UPSCALE);
        expect([plan.width, plan.height]).toEqual([400, 100]);
    });

    it("clamps a crop to the page and refuses one wholly outside it", () => {
        expect(planScreenshot(design, { x: 1800, y: 1000, width: 400, height: 400 }, 1280)?.source).toEqual({ x: 1800, y: 1000, width: 120, height: 80 });
        expect(planScreenshot(design, { x: 2000, y: 0, width: 100, height: 100 }, 1280)).toBeNull();
    });
});

describe("designRectFromClientRects", () => {
    it("undoes whatever zoom the page was drawn at", () => {
        // A 1920-wide page drawn 960 wide: everything measured is half size.
        expect(designRectFromClientRects(
            { left: 100, top: 50, width: 960, height: 540 },
            { left: 150, top: 75, width: 100, height: 40 },
            { width: 1920, height: 1080 },
        )).toEqual({ x: 100, y: 50, width: 200, height: 80 });
    });
});

describe("fitWithin", () => {
    it("scales down to the longer edge and leaves small pictures alone", () => {
        expect(fitWithin(2400, 1350, 1280)).toEqual({ width: 1280, height: 720, scale: 1280 / 2400 });
        expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600, scale: 1 });
    });
});

describe("drawnBounds", () => {
    const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
    it("joins a child that hangs over the element's edge", () => {
        expect(drawnBounds({ box: box(100, 100, 200, 140), clips: false, children: [
            { box: box(80, 60, 260, 150), clips: false, children: [] },
        ] })).toEqual(box(80, 60, 260, 150));
    });

    it("cuts children where a clipping box cuts them, including the element's own clip", () => {
        expect(drawnBounds({ box: box(100, 100, 200, 140), clips: true, children: [
            { box: box(80, 60, 260, 150), clips: false, children: [] },
        ] })).toEqual(box(100, 100, 200, 140));
        expect(drawnBounds({ box: box(0, 0, 100, 100), clips: false, children: [
            { box: box(10, 10, 50, 50), clips: true, children: [{ box: box(0, 0, 300, 300), clips: false, children: [] }] },
        ] })).toEqual(box(0, 0, 100, 100));
    });

    it("ignores boxes with no area", () => {
        expect(drawnBounds({ box: box(0, 0, 10, 10), clips: false, children: [{ box: box(500, 500, 500, 600), clips: false, children: [] }] }))
            .toEqual(box(0, 0, 10, 10));
    });
});
