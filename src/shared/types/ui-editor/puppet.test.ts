import { describe, expect, it } from "vitest";
import { defaultPuppetWidgetProps, isPuppetWidgetConfigured, normalizePuppetProps } from "./puppet";

describe("UI puppet prop normalizer", () => {
  it("falls back to defaults for missing input", () => {
    expect(normalizePuppetProps(undefined)).toEqual(defaultPuppetWidgetProps);
  });

  it("treats blank ids, backends and state names as absent", () => {
    expect(
      normalizePuppetProps({
        assetId: "   ",
        backend: "  ",
        motion: "",
        expression: "   ",
        skin: 7
      })
    ).toEqual(defaultPuppetWidgetProps);

    expect(
      normalizePuppetProps({
        assetId: "  model-1  ",
        backend: "  spine  ",
        motion: " idle "
      })
    ).toMatchObject({
      assetId: "model-1",
      backend: "spine",
      // Trimmed like the id: a name with stray whitespace is not a name a model answers to.
      motion: "idle"
    });
  });

  it("keeps options verbatim but only as an object", () => {
    // The author's bag: never inspected, never reshaped. Arrays and scalars are not an options
    // bag, and handing a backend one would be a silently different contract.
    expect(
      normalizePuppetProps({ options: { atlas: "a.atlas", premultiplied: true } }).options
    ).toEqual({ atlas: "a.atlas", premultiplied: true });
    expect(normalizePuppetProps({ options: [1, 2] }).options).toEqual({});
    expect(normalizePuppetProps({ options: "nope" }).options).toEqual({});
  });

  it("drops params that are not finite numbers", () => {
    // The engine's rule: an absent key keeps the model's own default, so dropping *is* clearing.
    // A NaN forwarded to a backend would instead move the parameter somewhere undefined.
    expect(
      normalizePuppetProps({
        params: {
          openEye: 0.5,
          angle: "12",
          broken: "x",
          worse: Number.NaN,
          // Each of these is a finite 0 under a blanket `Number()`, and none of them is a
          // parameter the author set to zero.
          missing: null,
          blank: "",
          flag: false
        }
      }).params
    ).toEqual({ openEye: 0.5, angle: 12 });
  });

  it("keeps a slot explicitly set to null, and drops values that are neither string nor null", () => {
    // `null` is a value here - a cleared slot - and not the same as a key that was never set.
    expect(
      normalizePuppetProps({
        slots: { weapon: "sword", hat: null, bad: 3 }
      }).slots
    ).toEqual({ weapon: "sword", hat: null });
  });

  it("copies the records rather than aliasing the stored props", () => {
    const raw = { params: { a: 1 }, slots: { b: "c" }, options: { d: true } };
    const normalized = normalizePuppetProps(raw);
    normalized.params.a = 2;
    normalized.slots.b = "z";
    normalized.options.d = false;
    expect(raw).toEqual({ params: { a: 1 }, slots: { b: "c" }, options: { d: true } });
  });

  it("is configured only with both a model and a backend", () => {
    expect(isPuppetWidgetConfigured(normalizePuppetProps({}))).toBe(false);
    expect(isPuppetWidgetConfigured(normalizePuppetProps({ assetId: "m" }))).toBe(false);
    expect(isPuppetWidgetConfigured(normalizePuppetProps({ backend: "b" }))).toBe(false);
    expect(isPuppetWidgetConfigured(normalizePuppetProps({ assetId: "m", backend: "b" }))).toBe(
      true
    );
  });
});
