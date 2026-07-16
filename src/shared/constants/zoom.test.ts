import { describe, expect, it } from "vitest";
import {
    TITLEBAR_HEIGHT_CSS_PX,
    ZOOM_PERCENT_DEFAULT,
    ZOOM_PERCENT_MAX,
    ZOOM_PERCENT_MIN,
    nextZoomPercent,
    normalizeZoomPercent,
    trafficLightPositionForZoom,
    zoomPercentToFactor,
} from "./zoom";

describe("normalizeZoomPercent", () => {
    it("falls back to the default for values that are not finite numbers", () => {
        expect(normalizeZoomPercent(undefined)).toBe(ZOOM_PERCENT_DEFAULT);
        expect(normalizeZoomPercent("nope")).toBe(ZOOM_PERCENT_DEFAULT);
        expect(normalizeZoomPercent(NaN)).toBe(ZOOM_PERCENT_DEFAULT);
    });

    it("clamps to the supported range and rounds to whole percentages", () => {
        expect(normalizeZoomPercent(10)).toBe(ZOOM_PERCENT_MIN);
        expect(normalizeZoomPercent(500)).toBe(ZOOM_PERCENT_MAX);
        expect(normalizeZoomPercent(123.6)).toBe(124);
    });
});

describe("nextZoomPercent", () => {
    it("walks the ladder from a value on it", () => {
        expect(nextZoomPercent(100, 1)).toBe(110);
        expect(nextZoomPercent(100, -1)).toBe(90);
    });

    it("jumps to the neighbouring step from a hand-typed value between steps", () => {
        expect(nextZoomPercent(137, 1)).toBe(150);
        expect(nextZoomPercent(137, -1)).toBe(125);
    });

    it("stays put at either end rather than wrapping", () => {
        expect(nextZoomPercent(ZOOM_PERCENT_MAX, 1)).toBe(ZOOM_PERCENT_MAX);
        expect(nextZoomPercent(ZOOM_PERCENT_MIN, -1)).toBe(ZOOM_PERCENT_MIN);
    });
});

describe("zoomPercentToFactor", () => {
    it("converts a percentage into the multiplier setZoomFactor expects", () => {
        expect(zoomPercentToFactor(125)).toBe(1.25);
        expect(zoomPercentToFactor(ZOOM_PERCENT_DEFAULT)).toBe(1);
    });
});

describe("trafficLightPositionForZoom", () => {
    it("keeps the pre-zoom position at 100%", () => {
        // The value the windows were hard-coded to before zoom existed.
        expect(trafficLightPositionForZoom(ZOOM_PERCENT_DEFAULT)).toEqual({ x: 14, y: 12 });
    });

    it("centres the lights in the scaled titlebar", () => {
        // The lights are a fixed physical size, so the gap above and below them
        // should stay equal as the bar grows.
        for (const percent of [ZOOM_PERCENT_MIN, 75, 100, 150, ZOOM_PERCENT_MAX]) {
            const { y } = trafficLightPositionForZoom(percent);
            const barHeight = TITLEBAR_HEIGHT_CSS_PX * zoomPercentToFactor(percent);
            const below = barHeight - y - 16;
            expect(Math.abs(below - y)).toBeLessThanOrEqual(1);
        }
    });

    it("never pushes the lights above the top edge", () => {
        expect(trafficLightPositionForZoom(ZOOM_PERCENT_MIN).y).toBeGreaterThanOrEqual(0);
    });

    it("holds the horizontal inset constant, as on native windows", () => {
        expect(trafficLightPositionForZoom(50).x).toBe(trafficLightPositionForZoom(200).x);
    });
});
