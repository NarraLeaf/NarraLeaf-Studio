import { describe, expect, it } from "vitest";
import { groupFontFaces } from "./systemFonts";

const face = (family: string, fullName: string, postscriptName = fullName.replace(/\s+/g, "")) => ({
  family,
  fullName,
  postscriptName,
  style: "Regular"
});

/**
 * `queryLocalFonts()` answers with FACES, not families — one entry per weight and style — so a
 * machine with 689 of them has a few hundred families to actually choose between. The grouping is
 * what turns that list into the one the picker shows.
 */
describe("groupFontFaces", () => {
  it("collapses a family's faces into one row", () => {
    const families = groupFontFaces([
      face("Georgia", "Georgia"),
      face("Georgia", "Georgia Bold"),
      face("Georgia", "Georgia Italic")
    ]);
    expect(families).toHaveLength(1);
    expect(families[0].family).toBe("Georgia");
  });

  /**
   * The whole reason aliases exist: Chromium reports most CJK families under a Latin name, so a
   * user typing what is printed on their font menu — 苹方, 阿里巴巴普惠体 — would otherwise find
   * nothing at all.
   */
  it("keeps the localized names a family can be searched by", () => {
    const families = groupFontFaces([
      face("Alibaba PuHuiTi 3.0", "阿里巴巴普惠体 3 55 Regular L3"),
      face("Alibaba PuHuiTi 3.0", "阿里巴巴普惠体 3 85 Bold")
    ]);
    expect(families[0].aliases).toContain("阿里巴巴普惠体 3 55 Regular L3");
    expect(families[0].aliases).toContain("阿里巴巴普惠体 3 85 Bold");
  });

  it("drops names that only repeat the family, which the family name already finds", () => {
    const families = groupFontFaces([face("Georgia", "Georgia Bold", "Georgia-Bold")]);
    expect(families[0].aliases).toEqual([]);
  });

  it("sorts families so the list reads alphabetically however the OS returned them", () => {
    const families = groupFontFaces([face("Zapfino", "Zapfino"), face("Arial", "Arial")]);
    expect(families.map((entry) => entry.family)).toEqual(["Arial", "Zapfino"]);
  });

  it("skips faces with no usable family name rather than making an empty row", () => {
    const families = groupFontFaces([
      face("", "Nameless"),
      {
        family: undefined as unknown as string,
        fullName: "Broken",
        postscriptName: "Broken",
        style: "Regular"
      },
      face("Arial", "Arial")
    ]);
    expect(families.map((entry) => entry.family)).toEqual(["Arial"]);
  });
});
