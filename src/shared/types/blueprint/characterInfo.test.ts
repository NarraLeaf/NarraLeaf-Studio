import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setActiveBrandPalette } from "@shared/brand/brandRegistry";
import { BUILTIN_BRAND_COLORS } from "@shared/types/brand";
import {
  normalizeBlueprintCharacterInfo,
  toBlueprintCharacterColor,
  toBlueprintCharacterInfo
} from "./characterInfo";

/**
 * The colour boundary, which is the one part of this module that can be wrong without saying so.
 *
 * `normalizeBlueprintRGBAColor` has no failure branch - anything it cannot read normalizes to opaque
 * white - so a stored value it does not understand does not produce an error or a null, it produces
 * a *colour*. A `nlbrand:` link is exactly such a value, which is why it has to come off before the
 * parse rather than being left to it.
 */
describe("toBlueprintCharacterColor", () => {
  beforeEach(() => {
    setActiveBrandPalette([...BUILTIN_BRAND_COLORS, { id: "cast.alice", value: "#123456" }]);
  });

  afterEach(() => {
    setActiveBrandPalette(BUILTIN_BRAND_COLORS);
  });

  it("reads a literal as the pin type, unchanged", () => {
    expect(toBlueprintCharacterColor("#123456")).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 1 });
  });

  it("resolves a link into the palette instead of parsing it as a colour", () => {
    expect(toBlueprintCharacterColor("nlbrand:cast.alice")).toEqual({
      r: 0x12,
      g: 0x34,
      b: 0x56,
      a: 1
    });
    // Not opaque white, which is what the raw parse of the link text would have produced.
    expect(toBlueprintCharacterColor("nlbrand:cast.alice")).not.toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 1
    });
  });

  it("keeps the opacity of a translucent palette entry, which the pin can carry", () => {
    // `button.shadow` is seeded as `rgba(0, 0, 0, 0.35)`. Unlike the nametag and Studio's chrome,
    // an RGBA pin has somewhere to put the alpha, so nothing is dropped here.
    expect(toBlueprintCharacterColor("nlbrand:button.shadow")).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0.35
    });
  });

  /**
   * Null, not white. A colour pin's own fallback is the caller's decision
   * (`blueprintCharacterColorOrDefault`), and collapsing "the author set nothing" into "the author
   * set white" here would take that decision away from every consumer at once.
   */
  it("answers null for every way there is no colour", () => {
    expect(toBlueprintCharacterColor(undefined)).toBeNull();
    expect(toBlueprintCharacterColor(null)).toBeNull();
    expect(toBlueprintCharacterColor("")).toBeNull();
    expect(toBlueprintCharacterColor("   ")).toBeNull();
    expect(toBlueprintCharacterColor(42)).toBeNull();
    // A link nothing answers for is a colour the project does not have, so it is no colour.
    expect(toBlueprintCharacterColor("nlbrand:gone")).toBeNull();
  });
});

describe("the character table entries a blueprint reads", () => {
  beforeEach(() => {
    setActiveBrandPalette([...BUILTIN_BRAND_COLORS, { id: "cast.alice", value: "#123456" }]);
  });

  afterEach(() => {
    setActiveBrandPalette(BUILTIN_BRAND_COLORS);
  });

  it("carries a linked accent through the summary boundary", () => {
    const info = toBlueprintCharacterInfo({ id: "c1", name: "Alice", color: "nlbrand:cast.alice" });

    expect(info?.color).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 1 });
  });

  it("carries it through the mirror a host writes, too", () => {
    const info = normalizeBlueprintCharacterInfo({
      id: "c1",
      name: "Alice",
      color: "nlbrand:cast.alice"
    });

    expect(info?.color).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 1 });
  });

  it("leaves a character with no accent with no colour", () => {
    expect(toBlueprintCharacterInfo({ id: "c1", name: "Alice" })?.color).toBeNull();
    expect(normalizeBlueprintCharacterInfo({ id: "c1", name: "Alice" })?.color).toBeNull();
  });
});
