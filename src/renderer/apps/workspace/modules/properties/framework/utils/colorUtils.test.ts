import { afterEach, describe, expect, it } from "vitest";
import {
  colorValueToCss,
  normalizeHex,
  normalizeHexInputDraft,
  parseColorValue,
  serializeColorValue
} from "./colorUtils";
import { formatBrandLink } from "@shared/brand/brandLink";
import { setActiveBrandPalette } from "@shared/brand/brandRegistry";
import { BUILTIN_BRAND_COLORS } from "@shared/types/brand";

describe("colorUtils", () => {
  it("normalizes complete hex colors", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("12ef9a")).toBe("#12EF9A");
  });

  it("rejects incomplete or invalid hex colors", () => {
    expect(normalizeHex("#12")).toBeNull();
    expect(normalizeHex("#1234")).toBeNull();
    expect(normalizeHex("#zzzzzz")).toBeNull();
  });

  it("keeps editable hex drafts without requiring a complete color", () => {
    expect(normalizeHexInputDraft("a")).toBe("#A");
    expect(normalizeHexInputDraft("#12")).toBe("#12");
    expect(normalizeHexInputDraft("00ccff")).toBe("#00CCFF");
    expect(normalizeHexInputDraft("#12x34yz56")).toBe("#123456");
  });

  it("falls back for invalid parsed colors", () => {
    const fallback = { hex: "#000000", alpha: 1 };
    expect(parseColorValue("#zzzzzz", fallback)).toEqual(fallback);
  });
});

/**
 * The safety net the brand rollout stands on, from this side.
 *
 * A `nlbrand:` link is stored in colour fields long before each of them has been taught to resolve
 * one, so what matters is that an unadopted field falls through to its own fallback rather than
 * painting something wrong. `normalizeHex` is one of the three parsers that could have mistaken a
 * link for a colour and is pinned here; the `rgb()`/`rgba()` regex behind `parseColorValue` is
 * pinned by the broken-link case below, which reaches it only because nothing earlier claimed the
 * string. The third is asserted in `@shared/brand/brandLink.test.ts`.
 *
 * Weaken any of these and a half-adopted project paints black where a button used to be.
 */
describe("colorUtils does not mistake a brand link for a color", () => {
  it("rejects it as hex", () => {
    expect(normalizeHex(formatBrandLink("primary"))).toBeNull();
    expect(normalizeHex(formatBrandLink("button.border", 0.5))).toBeNull();
  });
});

/**
 * Reading, painting and writing a link, against the seeded palette.
 *
 * The registry is module-level state shared by every test in the process, so each case that
 * publishes its own palette puts the seeds back afterwards. `setActiveBrandPalette` ignores a push
 * identical to the current one, which makes the restore free in the common case.
 *
 * The runtime host has the same module and the same cases in
 * `src/runtime/renderer/shims/colorUtils.test.ts`. Both must stay true: a shipped game that read a
 * link differently from the editor would only look wrong after it was built.
 */
describe("colorUtils resolves brand links", () => {
  afterEach(() => {
    setActiveBrandPalette(BUILTIN_BRAND_COLORS);
  });

  const fallback = { hex: "#123456", alpha: 1 };

  it("resolves a link to the colour it names, and keeps the id", () => {
    expect(parseColorValue(formatBrandLink("primary"), fallback)).toEqual({
      hex: "#40A8C4",
      alpha: 1,
      link: "primary"
    });
  });

  it("follows a link that points at another entry", () => {
    // `button.primary` is seeded as `nlbrand:primary`, which is the whole point of the feature.
    expect(parseColorValue(formatBrandLink("button.primary"), fallback)).toEqual({
      hex: "#40A8C4",
      alpha: 1,
      link: "button.primary"
    });
  });

  it("keeps the palette entry's own alpha when the link does not override it", () => {
    expect(parseColorValue(formatBrandLink("button.shadow"), fallback)).toEqual({
      hex: "#000000",
      alpha: 0.35,
      link: "button.shadow"
    });
  });

  it("takes the link's alpha as final rather than compounding it with the entry's", () => {
    // 0.5, not 0.5 * 0.35. This number is what the picker's opacity slider shows and writes
    // back; compounding would move the colour every time the panel was opened.
    expect(parseColorValue(formatBrandLink("button.shadow", 0.5), fallback)).toEqual({
      hex: "#000000",
      alpha: 0.5,
      link: "button.shadow"
    });
  });

  it("applies the link's alpha to the literal a chain ends at", () => {
    // `button.primary` is `nlbrand:primary`, so the alpha lands on `#40A8C4` two hops away.
    expect(parseColorValue(formatBrandLink("button.primary", 0.5), fallback)).toEqual({
      hex: "#40A8C4",
      alpha: 0.5,
      link: "button.primary"
    });
  });

  /**
   * The case the two implementations used to disagree about: an alpha written inside the palette
   * *and* one written in the field. The outer one is the author's most recent slider, and it
   * replaces rather than scales - multiplying would show 40% for a field storing 0.8.
   */
  it("takes the stored value's alpha over one written inside the palette, not the product", () => {
    setActiveBrandPalette([
      { id: "primary", value: "#40A8C4" },
      { id: "a", value: "nlbrand:primary/0.5" }
    ]);

    // 0.8, not 0.8 * 0.5 = 0.4.
    expect(parseColorValue("nlbrand:a/0.8", fallback)).toEqual({
      hex: "#40A8C4",
      alpha: 0.8,
      link: "a"
    });
    // With nothing written in the field, the entry's own 0.5 is what the slider shows.
    expect(parseColorValue("nlbrand:a", fallback)).toEqual({
      hex: "#40A8C4",
      alpha: 0.5,
      link: "a"
    });
    expect(colorValueToCss({ hex: "#FF0000", alpha: 0.8, link: "a" })).toBe(
      "rgba(64, 168, 196, 0.8)"
    );
    // Both spellings come back out as they went in: 0.5 belongs to the entry, so it is not
    // pinned into the field, and 0.8 does not, so it is.
    expect(serializeColorValue(parseColorValue("nlbrand:a/0.8", fallback))).toBe("nlbrand:a/0.8");
    expect(serializeColorValue(parseColorValue("nlbrand:a", fallback))).toBe("nlbrand:a");
  });

  it("hands back the caller's own fallback for an id nothing defines", () => {
    expect(parseColorValue(formatBrandLink("nosuchcolor"), fallback)).toBe(fallback);
  });

  it("hands back the caller's own fallback for a ring", () => {
    setActiveBrandPalette([
      { id: "primary", value: "nlbrand:secondary" },
      { id: "secondary", value: "nlbrand:primary" }
    ]);

    expect(parseColorValue(formatBrandLink("primary"), fallback)).toBe(fallback);
  });

  it("paints the palette's colour even when the caller is holding a stale hex", () => {
    // What makes "change the brand and everything follows" true for a consumer that parsed
    // before the change and has not re-read.
    expect(colorValueToCss({ hex: "#FF0000", alpha: 1, link: "primary" })).toBe("#40A8C4");
    expect(colorValueToCss({ hex: "#FF0000", alpha: 0.5, link: "primary" })).toBe(
      "rgba(64, 168, 196, 0.5)"
    );
  });

  it("paints the value's own hex when the link resolves to nothing", () => {
    expect(colorValueToCss({ hex: "#FF0000", alpha: 1, link: "nosuchcolor" })).toBe("#FF0000");
  });

  it("stores the link rather than the colour it resolved to", () => {
    expect(serializeColorValue({ hex: "#40A8C4", alpha: 1, link: "primary" })).toBe(
      "nlbrand:primary"
    );
    expect(serializeColorValue({ hex: "#40A8C4", alpha: 0.5, link: "primary" })).toBe(
      "nlbrand:primary/0.5"
    );
  });

  it("does not pin an alpha the author never chose", () => {
    // Reading `nlbrand:button.shadow` yields alpha 0.35 because the entry is translucent.
    // Writing that back must not turn the link into `nlbrand:button.shadow/0.35`, which would
    // stop it following the brand.
    const read = parseColorValue(formatBrandLink("button.shadow"), fallback);
    expect(serializeColorValue(read)).toBe("nlbrand:button.shadow");
    expect(serializeColorValue({ ...read, alpha: 0.5 })).toBe("nlbrand:button.shadow/0.5");
  });

  it("stores an ordinary colour exactly as it always did", () => {
    expect(serializeColorValue({ hex: "#40A8C4", alpha: 1 })).toBe(
      colorValueToCss({ hex: "#40A8C4", alpha: 1 })
    );
    expect(serializeColorValue({ hex: "#40A8C4", alpha: 0.5 })).toBe(
      colorValueToCss({ hex: "#40A8C4", alpha: 0.5 })
    );
    expect(serializeColorValue({ hex: "#40A8C4", alpha: 0.5 })).toBe("rgba(64, 168, 196, 0.5)");
  });

  it("lets the opacity slider reach 100% on a translucent brand colour", () => {
    // Dropping the segment here would mean "inherit", so the field would read back at the
    // entry's own 35% and the slider would spring back every time it was opened.
    const read = parseColorValue(formatBrandLink("button.shadow"), fallback);
    const opaque = serializeColorValue({ ...read, alpha: 1 });
    expect(opaque).toBe("nlbrand:button.shadow/1");
    expect(parseColorValue(opaque, fallback).alpha).toBe(1);
  });

  it("survives a round trip through the picker unchanged", () => {
    for (const stored of [
      "nlbrand:primary",
      "nlbrand:button.primary",
      "nlbrand:button.shadow",
      "nlbrand:primary/0.5",
      "nlbrand:button.shadow/0.5",
      "nlbrand:button.primary/0.5",
      "nlbrand:button.shadow/1"
    ]) {
      expect(serializeColorValue(parseColorValue(stored, fallback))).toBe(stored);
    }
  });
});
