import { describe, expect, it } from "vitest";
import { SCREENSHOT_MAX_UPSCALE, designRectFromClientRects, fitWithin, planScreenshot } from "./screenshotGeometry";

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
