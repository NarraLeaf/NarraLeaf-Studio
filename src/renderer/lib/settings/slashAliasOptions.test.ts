import { afterEach, describe, expect, it, vi } from "vitest";
import { isSimplifiedChineseDevice, slashAtAliasDefault } from "./slashAliasOptions";

/** Pretend the device advertises this ordered language list (most-preferred first). */
function withLanguages(languages: string[]): void {
    vi.stubGlobal("navigator", { language: languages[0] ?? "", languages });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("isSimplifiedChineseDevice", () => {
    it.each([
        ["zh"],
        ["zh-CN"],
        ["zh-Hans"],
        ["zh-Hans-CN"],
        ["zh-SG"],
        ["ZH-cn"], // case-insensitive
        ["zh_CN"], // underscore-tagged
    ])("counts %s as Simplified Chinese", (tag) => {
        withLanguages([tag]);
        expect(isSimplifiedChineseDevice()).toBe(true);
    });

    it.each([
        ["zh-Hant"],
        ["zh-TW"],
        ["zh-HK"],
        ["zh-MO"],
        ["zh-Hant-TW"],
    ])("does not count %s (Traditional)", (tag) => {
        withLanguages([tag]);
        expect(isSimplifiedChineseDevice()).toBe(false);
    });

    it.each([["en"], ["en-US"], ["ja"], ["fr-FR"], ["azh"]])(
        "does not count the non-Chinese tag %s",
        (tag) => {
            withLanguages([tag]);
            expect(isSimplifiedChineseDevice()).toBe(false);
        },
    );

    it("classifies on the first Chinese tag, ignoring later ones", () => {
        withLanguages(["en-US", "zh-CN", "zh-TW"]);
        expect(isSimplifiedChineseDevice()).toBe(true);
        withLanguages(["zh-TW", "zh-CN"]);
        expect(isSimplifiedChineseDevice()).toBe(false);
    });

    it("falls back to navigator.language when languages is empty", () => {
        vi.stubGlobal("navigator", { language: "zh-CN", languages: [] });
        expect(isSimplifiedChineseDevice()).toBe(true);
    });

    it("is false when no navigator exists (e.g. headless)", () => {
        vi.stubGlobal("navigator", undefined);
        expect(isSimplifiedChineseDevice()).toBe(false);
    });
});

describe("slashAtAliasDefault", () => {
    it("mirrors the device being Simplified Chinese", () => {
        withLanguages(["zh-CN"]);
        expect(slashAtAliasDefault()).toBe(true);
        withLanguages(["en-US"]);
        expect(slashAtAliasDefault()).toBe(false);
    });
});
