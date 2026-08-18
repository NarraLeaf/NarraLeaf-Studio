import { describe, expect, it } from "vitest";
import { BRAND_LINK_SCHEME, formatBrandLink, isBrandLink, parseBrandLink } from "./brandLink";
import { normalizeOpaqueBackgroundColor } from "@shared/utils/gameRuntimeEntrySurface";

describe("brand link", () => {
  it("reads a link with no alpha as the colour at its own opacity", () => {
    expect(parseBrandLink("nlbrand:primary")).toEqual({
      id: "primary",
      alpha: 1,
      alphaExplicit: false
    });
    expect(parseBrandLink("nlbrand:button.border")).toEqual({
      id: "button.border",
      alpha: 1,
      alphaExplicit: false
    });
    // A seeded slot is named after its widget, and one of those widgets is `textInput`.
    expect(parseBrandLink("nlbrand:textInput.background")).toEqual({
      id: "textInput.background",
      alpha: 1,
      alphaExplicit: false
    });
    // The generated ids an author's own colours get, in the same character set as the seeds.
    expect(parseBrandLink("nlbrand:c7f3a1b2")).toEqual({
      id: "c7f3a1b2",
      alpha: 1,
      alphaExplicit: false
    });
  });

  it("reads the alpha segment", () => {
    expect(parseBrandLink("nlbrand:primary/0.5")).toEqual({
      id: "primary",
      alpha: 0.5,
      alphaExplicit: true
    });
    expect(parseBrandLink("nlbrand:primary/0")).toEqual({
      id: "primary",
      alpha: 0,
      alphaExplicit: true
    });
    expect(parseBrandLink("nlbrand:text.muted/.25")).toEqual({
      id: "text.muted",
      alpha: 0.25,
      alphaExplicit: true
    });
  });

  /**
   * The distinction the resolver runs on. Both spellings carry alpha 1, and they do not mean the
   * same thing: `/1` is an author saying "this colour, opaque", which replaces the opacity of a
   * translucent palette entry, while no segment at all is "this colour as it stands". Collapse the
   * two and `nlbrand:button.shadow` starts painting solid black.
   */
  it("tells a written `/1` apart from no segment at all", () => {
    expect(parseBrandLink("nlbrand:primary/1")).toEqual({
      id: "primary",
      alpha: 1,
      alphaExplicit: true
    });
    expect(parseBrandLink("nlbrand:primary")?.alphaExplicit).toBe(false);
  });

  it("round-trips whatever it formats", () => {
    for (const [id, alpha] of [
      ["primary", undefined],
      ["button.text", 0.5],
      ["c7f3a1b2", 0]
    ] as const) {
      expect(parseBrandLink(formatBrandLink(id, alpha))).toEqual({
        id,
        alpha: alpha ?? 1,
        // Full opacity is written as no segment, so a formatted link is explicit exactly when
        // the alpha it was given was worth writing down.
        alphaExplicit: alpha !== undefined
      });
    }
  });

  it("leaves the alpha segment off when there is nothing to say", () => {
    expect(formatBrandLink("primary")).toBe("nlbrand:primary");
    expect(formatBrandLink("primary", 1)).toBe("nlbrand:primary");
    // Above the range, and not a number at all: both mean the colour as it is.
    expect(formatBrandLink("primary", 4)).toBe("nlbrand:primary");
    expect(formatBrandLink("primary", Number.NaN)).toBe("nlbrand:primary");
  });

  it("writes at most two decimals, with no trailing zeros", () => {
    expect(formatBrandLink("primary", 0.5)).toBe("nlbrand:primary/0.5");
    expect(formatBrandLink("primary", 0.5)).toBe("nlbrand:primary/0.5");
    expect(formatBrandLink("primary", 0.333333)).toBe("nlbrand:primary/0.33");
    expect(formatBrandLink("primary", 0.1 + 0.2)).toBe("nlbrand:primary/0.3");
    expect(formatBrandLink("primary", 0)).toBe("nlbrand:primary/0");
    expect(formatBrandLink("primary", -1)).toBe("nlbrand:primary/0");
    // Rounding up to a whole one drops the segment rather than writing `/1`.
    expect(formatBrandLink("primary", 0.999)).toBe("nlbrand:primary");
  });

  it("writes `/1` only when the caller says opaque is a choice, not an omission", () => {
    // No segment means "inherit the entry's alpha", which for a translucent entry is not the
    // same thing as opaque. The serializer asks for the long form in exactly that case.
    expect(formatBrandLink("button.shadow", 1, { writeOpaqueSegment: true })).toBe(
      "nlbrand:button.shadow/1"
    );
    expect(formatBrandLink("button.shadow", 0.999, { writeOpaqueSegment: true })).toBe(
      "nlbrand:button.shadow/1"
    );
    // The flag changes nothing below full opacity, and asking for no alpha still writes none.
    expect(formatBrandLink("button.shadow", 0.5, { writeOpaqueSegment: true })).toBe(
      "nlbrand:button.shadow/0.5"
    );
    expect(formatBrandLink("button.shadow", undefined, { writeOpaqueSegment: true })).toBe(
      "nlbrand:button.shadow"
    );
  });

  it("reads `/1` back as an alpha the author chose", () => {
    expect(parseBrandLink("nlbrand:button.shadow/1")).toEqual({
      id: "button.shadow",
      alpha: 1,
      alphaExplicit: true
    });
  });

  it("refuses anything that is not a link", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "#40A8C4",
      "rgba(0, 0, 0, 0.35)",
      "transparent",
      "primary",
      "nlbrand:",
      "nlbrand:Primary",
      "nlbrand:1primary",
      "nlbrand:my color",
      "nlbrand:a.b.c",
      "nlbrand:primary/",
      "nlbrand:primary/half",
      // Out of range is refused, not clamped: Studio never writes one, so a value like this is
      // a hand-edit, and repairing it would silently paint an opaque colour over a
      // translucent one instead of letting lint report the broken link.
      "nlbrand:primary/1.5",
      "nlbrand:primary/-0.5",
      "nlbrand:primary/0.5/0.5",
      " nlbrandprimary"
    ]) {
      expect(parseBrandLink(raw as string | null | undefined), String(raw)).toBeNull();
      expect(isBrandLink(raw as string | null | undefined), String(raw)).toBe(false);
    }
  });

  it("tolerates the whitespace a stored value can pick up", () => {
    expect(parseBrandLink("  nlbrand:primary  ")).toEqual({
      id: "primary",
      alpha: 1,
      alphaExplicit: false
    });
  });
});

/**
 * The safety net the whole rollout stands on.
 *
 * A link is stored in fields that have not been taught about brand yet, and this is the assertion
 * that such a field falls through to its own fallback rather than painting something wrong. The two
 * renderer-side parsers are pinned in `properties/framework/utils/colorUtils.test.ts`, which is the
 * layer that owns them; this is the shared one.
 */
describe("brand link is invisible to the colour parsers that have not adopted it", () => {
  it("is not an opaque background colour", () => {
    expect(normalizeOpaqueBackgroundColor("nlbrand:primary")).toBeNull();
    expect(normalizeOpaqueBackgroundColor("nlbrand:container.background/0.5")).toBeNull();
    // The bare-colour-name branch is the one a link could plausibly slip through; it cannot,
    // because that branch requires `^[a-z]+$` and the scheme carries a colon.
    expect(normalizeOpaqueBackgroundColor(BRAND_LINK_SCHEME)).toBeNull();
    expect(normalizeOpaqueBackgroundColor("rebeccapurple")).toBe("rebeccapurple");
  });
});
