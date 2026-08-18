import { describe, expect, it } from "vitest";
import { BrandPalette } from "@shared/brand/brandRegistry";
import { BUILTIN_BRAND_COLORS, type BrandColor } from "@shared/types/brand";
import { brandLinkExclusions } from "./ProjectDesignSection";

/**
 * The Brand panel's one invariant that cannot be seen on screen: the picker must never offer a
 * target that would close a ring.
 *
 * A ring makes `BrandPalette.resolveCss` return null for every id on it, so the failure is not "this
 * one colour looks wrong" but "several widgets across every surface silently fall back to their own
 * defaults at once", with the palette still listing colours that look fine. Refusing the pick up
 * front is the only place that is cheap to check.
 */

function palette(colors: BrandColor[]): BrandPalette {
  return new BrandPalette(colors);
}

function color(id: string, value: string): BrandColor {
  return { id, value };
}

describe("brandLinkExclusions", () => {
  it("withholds the entry being edited", () => {
    const excluded = brandLinkExclusions(palette([color("primary", "#40A8C5")]), "primary");
    expect(excluded).toEqual(["primary"]);
  });

  it("withholds anything already pointing at the entry", () => {
    // `button.primary` -> `primary` is the seeded default. Pointing `primary` back at it would
    // leave the two resolving through each other and painting nothing.
    const list = palette([
      color("primary", "#40A8C5"),
      color("secondary", "#2E6E80"),
      color("button.primary", "nlbrand:primary")
    ]);
    expect(brandLinkExclusions(list, "primary").sort()).toEqual(["button.primary", "primary"]);
    // The other direction is legal and must stay on offer: a slot may point at a colour.
    expect(brandLinkExclusions(list, "button.primary").sort()).toEqual(["button.primary"]);
  });

  it("follows a chain rather than only its first link", () => {
    const list = palette([
      color("a", "#111111"),
      color("b", "nlbrand:a"),
      color("c", "nlbrand:b"),
      color("unrelated", "#222222")
    ]);
    // `c` reaches `a` through `b`, so pointing `a` at either would close the ring.
    expect(brandLinkExclusions(list, "a").sort()).toEqual(["a", "b", "c"]);
    expect(brandLinkExclusions(list, "b").sort()).toEqual(["b", "c"]);
    expect(brandLinkExclusions(list, "c")).toEqual(["c"]);
  });

  it("keeps offering the colours that cannot reach the entry", () => {
    const list = palette([
      color("primary", "#40A8C5"),
      color("background", "#101317"),
      color("container.background", "nlbrand:background")
    ]);
    expect(brandLinkExclusions(list, "primary")).toEqual(["primary"]);
  });

  it("withholds an alpha-carrying link the same way as a bare one", () => {
    // `nlbrand:<id>/<alpha>` is the same reference at less of it, and it closes a ring just as
    // hard - the alpha segment must not make the chain invisible to this walk.
    const list = palette([
      color("primary", "#40A8C5"),
      color("button.shadow", "nlbrand:primary/0.35")
    ]);
    expect(brandLinkExclusions(list, "primary").sort()).toEqual(["button.shadow", "primary"]);
  });

  it("withholds every seeded slot that resolves through the seeded primary", () => {
    // Against the real seed order, so a slot added to `BUILTIN_BRAND_COLORS` without a thought
    // for cycles shows up here rather than in a project whose palette stopped painting.
    const excluded = new Set(brandLinkExclusions(palette([...BUILTIN_BRAND_COLORS]), "primary"));
    expect(excluded.has("primary")).toBe(true);
    expect(excluded.has("button.primary")).toBe(true);
    expect(excluded.has("secondary")).toBe(false);
    expect(excluded.has("button.shadow")).toBe(false);
  });
});
