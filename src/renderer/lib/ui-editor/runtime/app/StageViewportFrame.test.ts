import { describe, expect, it } from "vitest";
import { computeStageViewportMetrics } from "./StageViewportFrame";

const DESIGN_16_9 = { width: 1920, height: 1080 };

describe("computeStageViewportMetrics — contain (the historical behaviour)", () => {
    it("fits the whole design inside the area and leaves bars, cropping nothing", () => {
        // A 20:9 phone in landscape: relatively wider than the design, so the height binds.
        const area = { width: 2400, height: 1080 };
        const m = computeStageViewportMetrics({ area, designSize: DESIGN_16_9, fit: "contain" });
        expect(m.renderScale).toBe(1);
        expect(m.backingWidth).toBe(1920);
        expect(m.backingHeight).toBe(1080);
        expect(m.croppedWidth).toBe(0);
        expect(m.croppedHeight).toBe(0);
    });

    it("is what an omitted fit does — no caller has to opt out of cropping", () => {
        const area = { width: 2400, height: 1080 };
        expect(computeStageViewportMetrics({ area, designSize: DESIGN_16_9 }))
            .toEqual(computeStageViewportMetrics({ area, designSize: DESIGN_16_9, fit: "contain" }));
    });
});

describe("computeStageViewportMetrics — cover", () => {
    it("a relatively WIDER screen fills the width and crops vertically", () => {
        // 2400x1080 against 16:9: scale = max(2400/1920, 1080/1080) = 1.25.
        const m = computeStageViewportMetrics({
            area: { width: 2400, height: 1080 },
            designSize: DESIGN_16_9,
            fit: "cover",
        });
        expect(m.renderScale).toBe(1.25);
        expect(m.backingWidth).toBe(2400);
        expect(m.backingHeight).toBe(1350);
        expect(m.croppedWidth).toBe(0);
        expect(m.croppedHeight).toBe(270);
    });

    it("a relatively NARROWER screen fills the height and crops horizontally", () => {
        // A 4:3 tablet. scale = max(1024/1920, 768/1080) = 768/1080 = 0.7111…
        const m = computeStageViewportMetrics({
            area: { width: 1024, height: 768 },
            designSize: DESIGN_16_9,
            fit: "cover",
        });
        expect(m.renderScale).toBeCloseTo(768 / 1080, 12);
        expect(m.backingHeight).toBeCloseTo(768, 9);
        expect(m.backingWidth).toBeCloseTo(1920 * (768 / 1080), 9);
        expect(m.croppedHeight).toBe(0);
        expect(m.croppedWidth).toBeGreaterThan(0);
    });

    it("never crops both axes at once — the chosen ratio is exact on one of them", () => {
        const areas = [
            { width: 2400, height: 1080 },
            { width: 1024, height: 768 },
            { width: 1920, height: 1080 },
            { width: 800, height: 2000 },
            { width: 3000, height: 400 },
        ];
        for (const area of areas) {
            const m = computeStageViewportMetrics({ area, designSize: DESIGN_16_9, fit: "cover" });
            expect(Math.min(m.croppedWidth, m.croppedHeight)).toBeCloseTo(0, 9);
            // And it always covers: neither axis falls short of the area.
            expect(m.backingWidth).toBeGreaterThanOrEqual(area.width - 1e-9);
            expect(m.backingHeight).toBeGreaterThanOrEqual(area.height - 1e-9);
        }
    });

    it("an exact-aspect screen crops nothing, so cover and contain agree", () => {
        const area = { width: 1280, height: 720 };
        expect(computeStageViewportMetrics({ area, designSize: DESIGN_16_9, fit: "cover" }))
            .toEqual(computeStageViewportMetrics({ area, designSize: DESIGN_16_9, fit: "contain" }));
    });

    it("falls back to scale 1 before the first measurement, under either fit", () => {
        for (const fit of ["contain", "cover"] as const) {
            const m = computeStageViewportMetrics({ area: null, designSize: DESIGN_16_9, fit });
            expect(m.renderScale).toBe(1);
            expect(m.backingWidth).toBe(1920);
            // Nothing is reported as cropped while there is no area to crop against.
            expect(m.croppedWidth).toBe(0);
            expect(m.croppedHeight).toBe(0);
        }
        const collapsed = computeStageViewportMetrics({
            area: { width: 0, height: 500 },
            designSize: DESIGN_16_9,
            fit: "cover",
        });
        expect(collapsed.renderScale).toBe(1);
    });

    it("survives a degenerate design size rather than producing NaN geometry", () => {
        const m = computeStageViewportMetrics({
            area: { width: 800, height: 600 },
            designSize: { width: 0, height: 0 },
            fit: "cover",
        });
        expect(Number.isFinite(m.renderScale)).toBe(true);
        expect(Number.isFinite(m.backingWidth)).toBe(true);
        expect(Number.isFinite(m.backingHeight)).toBe(true);
    });
});
