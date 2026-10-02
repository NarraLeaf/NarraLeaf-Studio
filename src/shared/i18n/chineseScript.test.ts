import { describe, expect, it } from "vitest";

import { chineseScriptOf, localeTagParts } from "./chineseScript";

/**
 * The one table both a shipped game's locale packs and its first-launch language match read: which
 * script a Chinese tag is written in, whether the tag names the script or only a region.
 */
describe("chineseScriptOf", () => {
    it.each([
        ["zh-Hans", "hans"],
        ["zh-Hant", "hant"],
        ["zh-Hans-HK", "hans"],
        ["zh-Hant-CN", "hant"],
        ["zh-CN", "hans"],
        ["zh-SG", "hans"],
        ["zh-MY", "hans"],
        ["zh-TW", "hant"],
        ["zh-HK", "hant"],
        ["zh-MO", "hant"],
        ["zh_TW", "hant"],
        ["zh_CN.UTF-8", "hans"],
        ["ZH-hant-tw", "hant"],
    ])("reads %s as %s", (tag, script) => {
        expect(chineseScriptOf(tag)).toBe(script);
    });

    it("reads a region nobody listed as Simplified, as Chromium does", () => {
        expect(chineseScriptOf("zh-US")).toBe("hans");
    });

    it("says nothing for bare Chinese, or for a language that is not Chinese", () => {
        for (const tag of ["zh", "ja", "ja-JP", "en-TW", "", "Chinese"]) {
            expect(chineseScriptOf(tag)).toBeNull();
        }
    });
});

describe("localeTagParts", () => {
    it("takes a tag apart into lower-cased language, script and region", () => {
        expect(localeTagParts("zh-Hant-HK")).toEqual({ language: "zh", script: "hant", region: "hk" });
        expect(localeTagParts("es-419")).toEqual({ language: "es", script: null, region: "419" });
        expect(localeTagParts("sr_Latn")).toEqual({ language: "sr", script: "latn", region: null });
    });

    it("is nothing for a tag that does not begin with a language code", () => {
        expect(localeTagParts("-Hans")).toBeNull();
        expect(localeTagParts("1234")).toBeNull();
    });
});
