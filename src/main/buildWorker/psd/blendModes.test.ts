import { describe, expect, it } from "vitest";
import { canMergeBlendMode, MERGEABLE_BLEND_MODES } from "@shared/utils/psdLayerPlan";
import { blendOver, canMerge, nonSeparableBlend, separableBlend } from "./blendModes";

describe("separableBlend", () => {
  it("implements exactly the modes the UI offers to merge", () => {
    // The wizard greys out a choice from the shared list, in the renderer, before the author
    // makes it; the worker has to be able to honour every one of them and must not quietly do
    // one the wizard never offered. The two lists are duplicated across a process boundary, so
    // this is the only thing keeping them honest.
    for (const mode of MERGEABLE_BLEND_MODES) {
      expect(canMerge(mode), mode).toBe(true);
    }
    expect(canMerge("dissolve")).toBe(false);
    expect(canMergeBlendMode("dissolve")).toBe(false);
  });

  it("computes the usual pairs", () => {
    expect(separableBlend("multiply")!(0.5, 0.5)).toBeCloseTo(0.25);
    expect(separableBlend("screen")!(0.5, 0.5)).toBeCloseTo(0.75);
    expect(separableBlend("darken")!(0.2, 0.8)).toBe(0.2);
    expect(separableBlend("lighten")!(0.2, 0.8)).toBe(0.8);
  });
});

describe("nonSeparableBlend", () => {
  const lum = (c: [number, number, number]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const backdrop: [number, number, number] = [0.2, 0.6, 0.4];
  const source: [number, number, number] = [0.9, 0.1, 0.3];

  it("keeps the backdrop's luminosity for hue, saturation and color", () => {
    // This is the defining property in the W3C spec: only `luminosity` moves brightness.
    for (const mode of ["hue", "saturation", "color"]) {
      expect(lum(nonSeparableBlend(mode)!(backdrop, source)), mode).toBeCloseTo(lum(backdrop), 5);
    }
  });

  it("takes the source's luminosity for luminosity", () => {
    expect(lum(nonSeparableBlend("luminosity")!(backdrop, source))).toBeCloseTo(lum(source), 5);
  });

  it("keeps the backdrop's saturation for hue, and the source's for saturation", () => {
    // Both sides are mid-toned and lightly saturated on purpose: `SetLum` can push a channel out
    // of the cube, and the spec's `ClipColor` then pulls it back by *reducing* saturation. That
    // is correct behaviour, so a pair that would clip could not test this property at all.
    const sat = (c: [number, number, number]) => Math.max(...c) - Math.min(...c);
    const base: [number, number, number] = [0.4, 0.5, 0.6];
    const over: [number, number, number] = [0.5, 0.5, 0.7];
    expect(sat(nonSeparableBlend("hue")!(base, over))).toBeCloseTo(sat(base), 5);
    expect(sat(nonSeparableBlend("saturation")!(base, over))).toBeCloseTo(sat(over), 5);
  });

  it("is the identity when both sides are the same colour", () => {
    for (const mode of ["hue", "saturation", "color", "luminosity"]) {
      const out = nonSeparableBlend(mode)!(backdrop, backdrop);
      out.forEach((v, i) => expect(v, `${mode}[${i}]`).toBeCloseTo(backdrop[i], 5));
    }
  });

  it("picks a whole pixel for darker/lighter colour", () => {
    expect(nonSeparableBlend("darkerColor")!(backdrop, source)).toEqual(source);
    expect(nonSeparableBlend("lighterColor")!(backdrop, source)).toEqual(backdrop);
  });

  it("stays inside the cube when luminosity would push a channel out", () => {
    // SetLum on a saturated colour overshoots without ClipColor; a raw version returns >1 here.
    const out = nonSeparableBlend("color")!([0.95, 0.95, 0.95], [1, 0, 0]);
    out.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
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
