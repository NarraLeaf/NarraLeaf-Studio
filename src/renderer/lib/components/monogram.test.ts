import { describe, expect, it } from "vitest";
import { nameMonogramColor, nameInitials } from "./monogram";

describe("nameInitials", () => {
  it("takes one letter from a single word", () => {
    expect(nameInitials("Demo")).toBe("D");
  });

  it("takes the first letters of the first two words", () => {
    expect(nameInitials("My Game")).toBe("MG");
    expect(nameInitials("my_game")).toBe("MG");
    expect(nameInitials("Aumiao-py")).toBe("AP");
  });

  it("splits camel case", () => {
    expect(nameInitials("CodemaoAutoTop")).toBe("CA");
  });

  /**
   * Both helpers are total. A nameless history record reached this function, threw on
   * `name.length`, and the critical error boundary answered by terminating the app - on every
   * launch, because the record is persisted.
   */
  it("survives a missing, null or empty name instead of throwing", () => {
    expect(nameInitials(undefined)).toBe("?");
    expect(nameInitials(null)).toBe("?");
    expect(nameInitials("")).toBe("?");
    expect(nameInitials("   ")).toBe("?");
    expect(nameInitials("...")).toBe("?");
  });
});

describe("nameMonogramColor", () => {
  it("is stable for a name and different across names", () => {
    expect(nameMonogramColor("My Game")).toBe(nameMonogramColor("My Game"));
    expect(nameMonogramColor("My Game")).not.toBe(nameMonogramColor("Other"));
  });

  it("returns a usable colour for a missing name instead of throwing", () => {
    for (const name of [undefined, null, ""] as const) {
      expect(nameMonogramColor(name)).toMatch(/^hsl\(\d+ 30% 44%\)$/);
    }
  });
});
