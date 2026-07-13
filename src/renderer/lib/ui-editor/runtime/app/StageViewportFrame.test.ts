import { describe, expect, it } from "vitest";
import { computeStageViewportMetrics } from "./StageViewportFrame";

const DESIGN = { width: 1920, height: 1080 };

describe("computeStageViewportMetrics", () => {
    it("renders natively (no clamp): backing = fit size, no CSS upscale", () => {
        // A 4K-ish area, 16:9. fit = 3840/1920 = 2 (height-limited would give 2160/1080 = 2 too).
        const m = computeStageViewportMetrics({
            area: { width: 3840, height: 2160 },
            designSize: DESIGN,
            outputResolution: null,
        });
        expect(m.renderScale).toBe(2);
        expect(m.displayScale).toBe(1);
        expect(m.backingWidth).toBe(3840);
        expect(m.backingHeight).toBe(2160);
    });

    it("downsamples to a lower target on a large screen (720p target in a 4K area)", () => {
        const m = computeStageViewportMetrics({
            area: { width: 3840, height: 2160 },
            designSize: DESIGN,
            outputResolution: { width: 1280, height: 720 },
        });
        // Stage lays out at 720p (renderScale = 1280/1920 = 2/3), then CSS-upscales 3x to fill 4K.
        expect(m.renderScale).toBeCloseTo(1280 / 1920);
        expect(m.backingWidth).toBeCloseTo(1280);
        expect(m.backingHeight).toBeCloseTo(720);
        expect(m.displayScale).toBeCloseTo(3); // fit(2) / renderScale(2/3) = 3
        // The on-screen size is unchanged from native: backing * displayScale === fit size.
        expect(m.backingWidth * m.displayScale).toBeCloseTo(3840);
    });

    it("supersamples when the target exceeds the fit size (target > area)", () => {
        const m = computeStageViewportMetrics({
            area: { width: 1280, height: 720 },
            designSize: DESIGN,
            outputResolution: { width: 3840, height: 2160 },
        });
        expect(m.backingWidth).toBeCloseTo(3840);
        expect(m.displayScale).toBeLessThan(1); // scaled DOWN to fit → crisper
        expect(m.backingWidth * m.displayScale).toBeCloseTo(1280);
    });

    it("keeps the on-screen size identical whether clamped or not (same fit)", () => {
        const area = { width: 2560, height: 1440 };
        const native = computeStageViewportMetrics({ area, designSize: DESIGN, outputResolution: null });
        const clamped = computeStageViewportMetrics({
            area,
            designSize: DESIGN,
            outputResolution: { width: 1280, height: 720 },
        });
        expect(clamped.backingWidth * clamped.displayScale).toBeCloseTo(native.backingWidth * native.displayScale);
        expect(clamped.backingHeight * clamped.displayScale).toBeCloseTo(native.backingHeight * native.displayScale);
    });

    it("ignores a zero/invalid output resolution (renders natively)", () => {
        const area = { width: 1920, height: 1080 };
        expect(
            computeStageViewportMetrics({ area, designSize: DESIGN, outputResolution: { width: 0, height: 0 } }).displayScale,
        ).toBe(1);
        expect(
            computeStageViewportMetrics({ area, designSize: DESIGN, outputResolution: { width: 1280, height: Number.NaN } }).displayScale,
        ).toBe(1);
    });

    it("falls back to fit = 1 before the area is measured", () => {
        const m = computeStageViewportMetrics({ area: null, designSize: DESIGN, outputResolution: null });
        expect(m.renderScale).toBe(1);
        expect(m.backingWidth).toBe(1920);
    });
});
