import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceDefaultLocale, deviceLanguageTags } from "./deviceLocale";

/** Pretend the device advertises this ordered language list (most-preferred first). */
function withLanguages(languages: string[]): void {
  vi.stubGlobal("navigator", { language: languages[0] ?? "", languages });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deviceLanguageTags", () => {
  it("normalizes case and underscores", () => {
    withLanguages(["ZH_CN", "en-US"]);
    expect(deviceLanguageTags()).toEqual(["zh-cn", "en-us", "zh-cn"]);
  });

  it("falls back to navigator.language when the list is empty", () => {
    vi.stubGlobal("navigator", { language: "zh-CN", languages: [] });
    expect(deviceLanguageTags()).toEqual(["zh-cn"]);
  });

  it("is empty where there is no navigator", () => {
    vi.stubGlobal("navigator", undefined);
    expect(deviceLanguageTags()).toEqual([]);
  });

  it("drops empty entries rather than reporting them as tags", () => {
    vi.stubGlobal("navigator", { language: "", languages: ["en"] });
    expect(deviceLanguageTags()).toEqual(["en"]);
  });
});

describe("deviceDefaultLocale", () => {
  it.each([
    ["zh", "zh"],
    ["zh-CN", "zh"],
    ["zh-Hans-CN", "zh"],
    ["en", "en"],
    ["en-GB", "en"]
  ])("resolves %s to %s", (tag, expected) => {
    withLanguages([tag]);
    expect(deviceDefaultLocale()).toBe(expected);
  });

  it("takes the first language Studio actually has, not the first language listed", () => {
    // The ordered list is a preference order. With no French build, the next thing this
    // device asked for is Chinese - falling back to English here would ignore what it said.
    withLanguages(["fr-FR", "zh-CN", "en-US"]);
    expect(deviceDefaultLocale()).toBe("zh");
  });

  it("falls back to English when nothing matches", () => {
    withLanguages(["fr-FR", "de-DE"]);
    expect(deviceDefaultLocale()).toBe("en");
  });

  it("falls back to English where there is no navigator", () => {
    vi.stubGlobal("navigator", undefined);
    expect(deviceDefaultLocale()).toBe("en");
  });
});
