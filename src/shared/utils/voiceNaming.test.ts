import { describe, expect, it } from "vitest";
import { formatVoiceFilename, matchKeyForFilename, VOICE_NAME_TOKENS } from "./voiceNaming";

const PATTERN = "{scene}_{index}_{character}";

function tokens(overrides: Partial<Parameters<typeof formatVoiceFilename>[1]> = {}) {
  return {
    scene: "Prologue",
    index: 1,
    character: "Alice",
    locale: "ja",
    unitId: "t-1",
    ...overrides
  };
}

describe("formatVoiceFilename", () => {
  it("fills the documented tokens", () => {
    expect(formatVoiceFilename(PATTERN, tokens())).toBe("Prologue_001_Alice");
    expect(formatVoiceFilename("{locale}/{unit}", tokens())).toBe("ja/t-1");
  });

  it("accepts {unitId} as well as {unit}", () => {
    // The type field is `unitId` and the docs said `unitId`, but only `{unit}` was ever
    // substituted - so the spelling a reader would copy landed in the filename verbatim.
    expect(formatVoiceFilename("{unitId}", tokens())).toBe("t-1");
    expect(formatVoiceFilename("{unitid}", tokens())).toBe("t-1");
  });

  it("leaves an unknown token alone", () => {
    expect(formatVoiceFilename("{take}", tokens())).toBe("{take}");
  });

  it("keeps CJK names in the filename", () => {
    expect(formatVoiceFilename(PATTERN, tokens({ scene: "序章", character: "優希" }))).toBe(
      "序章_001_優希"
    );
  });
});

describe("matchKeyForFilename", () => {
  it("ignores extension, folders, case and cosmetic punctuation", () => {
    expect(matchKeyForFilename("takes/Prologue_001_Alice.wav")).toBe(
      matchKeyForFilename("prologue 001-alice.mp3")
    );
  });

  /**
   * The defect this whole change exists for. The key used to be `[^a-z0-9]`, so every CJK
   * character was deleted and two scenes' first lines both reduced to "001" - `buildVoiceNameKeyMap`
   * then dropped both as ambiguous and batch import matched nothing at all.
   */
  it("keeps CJK apart instead of collapsing it to the index", () => {
    const a = matchKeyForFilename(
      formatVoiceFilename(PATTERN, tokens({ scene: "序章", character: "優希" }))
    );
    const b = matchKeyForFilename(
      formatVoiceFilename(PATTERN, tokens({ scene: "第一章", character: "優希" }))
    );

    expect(a).not.toBe(b);
    expect(a).toBe("序章001優希");
  });

  it("matches a decomposed filename from a macOS booth against the composed one", () => {
    const composed = "ぷろろーぐ_001_ゆうき.wav";
    expect(matchKeyForFilename(composed.normalize("NFD"))).toBe(matchKeyForFilename(composed));
  });

  it("matches full-width digits against half-width ones", () => {
    expect(matchKeyForFilename("序章_００１_優希.wav")).toBe(
      matchKeyForFilename("序章_001_優希.wav")
    );
  });

  it("still reduces a name with nothing but punctuation to an empty key", () => {
    expect(matchKeyForFilename("---.wav")).toBe("");
  });
});

describe("VOICE_NAME_TOKENS", () => {
  it("lists only tokens the formatter actually substitutes", () => {
    for (const token of VOICE_NAME_TOKENS) {
      expect(formatVoiceFilename(`{${token}}`, tokens())).not.toBe(`{${token}}`);
    }
  });
});
