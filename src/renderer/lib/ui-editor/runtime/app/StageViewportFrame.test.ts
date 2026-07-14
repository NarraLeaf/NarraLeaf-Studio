import { describe, expect, it } from "vitest";
import { computeStageViewportMetrics } from "./StageViewportFrame";

const DESIGN = { width: 1920, height: 1080 };

describe("computeStageViewportMetrics", () => {
    it("fits the stage to the area, preserving the design aspect ratio", () => {
        // A 4K area, 16:9. fit = 3840/1920 = 2 (2160/1080 = 2 too).
        const m = computeStageViewportMetrics({
            area: { width: 3840, height: 2160 },
            designSize: DESIGN,
        });
        expect(m.renderScale).toBe(2);
        expect(m.backingWidth).toBe(3840);
        expect(m.backingHeight).toBe(2160);
    });

    it("is height-limited when the area is wider than the design aspect", () => {
        const m = computeStageViewportMetrics({
            area: { width: 4000, height: 2160 },
            designSize: DESIGN,
        });
        // min(4000/1920 = 2.083, 2160/1080 = 2) = 2
        expect(m.renderScale).toBe(2);
        expect(m.backingWidth).toBe(3840);
        expect(m.backingHeight).toBe(2160);
    });

    it("is width-limited when the area is taller than the design aspect", () => {
        const m = computeStageViewportMetrics({
            area: { width: 1920, height: 2000 },
            designSize: DESIGN,
        });
        // min(1920/1920 = 1, 2000/1080 = 1.85) = 1
        expect(m.renderScale).toBe(1);
        expect(m.backingWidth).toBe(1920);
        expect(m.backingHeight).toBe(1080);
    });

    it("falls back to fit = 1 before the area is measured", () => {
        const m = computeStageViewportMetrics({ area: null, designSize: DESIGN });
        expect(m.renderScale).toBe(1);
        expect(m.backingWidth).toBe(1920);
        expect(m.backingHeight).toBe(1080);
    });

    it("treats a collapsed (zero-dimension) area as unmeasured instead of shrinking to nothing", () => {
        // A height:100% collapse (unsized parent) yields area.height 0 — must not drive the stage to 0.
        const m = computeStageViewportMetrics({
            area: { width: 1280, height: 0 },
            designSize: DESIGN,
        });
        expect(m.renderScale).toBe(1);
        expect(m.backingWidth).toBeGreaterThan(0);
        expect(Number.isFinite(m.renderScale)).toBe(true);
    });
});
