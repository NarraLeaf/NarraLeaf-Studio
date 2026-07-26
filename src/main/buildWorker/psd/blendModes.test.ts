import { describe, expect, it } from "vitest";
import { SEPARABLE_BLEND_MODES } from "@shared/utils/psdLayerPlan";
import { blendOver, canMerge, separableBlend } from "./blendModes";

describe("separableBlend", () => {
    it("implements exactly the modes the UI offers to merge", () => {
        // The wizard decides what to offer from the shared list; the worker has to be able to do all
        // of them, and must not quietly do one the wizard never offers.
        for (const mode of SEPARABLE_BLEND_MODES) {
            expect(canMerge(mode), mode).toBe(true);
        }
        expect(canMerge("hue")).toBe(false);
        expect(canMerge("luminosity")).toBe(false);
    });

    it("computes the usual pairs", () => {
        expect(separableBlend("multiply")!(0.5, 0.5)).toBeCloseTo(0.25);
        expect(separableBlend("screen")!(0.5, 0.5)).toBeCloseTo(0.75);
        expect(separableBlend("darken")!(0.2, 0.8)).toBe(0.2);
        expect(separableBlend("lighten")!(0.2, 0.8)).toBe(0.8);
    });
});

describe("blendOver", () => {
    const pixel = (r: number, g: number, b: number, a: number) => new Uint8Array([r, g, b, a]);

    it("multiplies a source over an opaque backdrop", () => {
        const backdrop = pixel(200, 200, 200, 255);
        blendOver(backdrop, pixel(128, 128, 128, 255), "multiply");
        expect(backdrop[0]).toBeGreaterThan(95);
        expect(backdrop[0]).toBeLessThan(105);
    });

    it("shows the source unblended where the backdrop is empty", () => {
        // Otherwise a multiply layer over transparent canvas would come out black.
        const backdrop = pixel(0, 0, 0, 0);
        blendOver(backdrop, pixel(180, 40, 40, 255), "multiply");
        expect([...backdrop]).toEqual([180, 40, 40, 255]);
    });

    it("leaves the backdrop alone where the source is transparent", () => {
        const backdrop = pixel(10, 20, 30, 255);
        blendOver(backdrop, pixel(255, 255, 255, 0), "multiply");
        expect([...backdrop]).toEqual([10, 20, 30, 255]);
    });
});
