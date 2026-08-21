import { describe, expect, it } from "vitest";
import type { FontCoverage } from "./fontCoverage";
import { scriptProfileForLocale, suggestLocalesForCoverage } from "./localeScripts";

/** A font that declares these code pages and draws these code points, and nothing else. */
function font(codePages: number[], codePoints: number[] = []): FontCoverage {
    const ranges = [...codePoints].sort((a, b) => a - b).map(point => [point, point] as const);
    return { ranges, count: ranges.length, codePages };
}

const LATIN = [0x0041, 0x0061, 0x00e9];
const KANA = [0x3042, 0x30a2, 0x65e5, 0x672c];
const HANGUL = [0xd55c, 0xad6d, 0xae00];
const THAI = [0x0e01, 0x0e17];

describe("scriptProfileForLocale", () => {
    it("reads the script off the language subtag", () => {
        expect(scriptProfileForLocale("ja").id).toBe("japanese");
        expect(scriptProfileForLocale("ko-KR").id).toBe("korean");
        expect(scriptProfileForLocale("ru").id).toBe("cyrillic");
    });

    it("prefers the longest matching prefix", () => {
        expect(scriptProfileForLocale("zh-Hant-HK").id).toBe("chinese-traditional");
        expect(scriptProfileForLocale("zh-TW").id).toBe("chinese-traditional");
        expect(scriptProfileForLocale("zh-Hans-CN").id).toBe("chinese-simplified");
    });

    it("reads a bare zh as Simplified", () => {
        expect(scriptProfileForLocale("zh").id).toBe("chinese-simplified");
    });

    it("matches on subtag boundaries, not on characters", () => {
        // `zho` is a language of its own and must not be read as `zh`; `he` must not catch `hei`.
        expect(scriptProfileForLocale("zho").id).toBe("latin");
        expect(scriptProfileForLocale("hei").id).toBe("latin");
    });

    it("falls back to Latin for everything it does not name", () => {
        expect(scriptProfileForLocale("en-US").id).toBe("latin");
        expect(scriptProfileForLocale("pt-BR").id).toBe("latin");
        expect(scriptProfileForLocale("").id).toBe("latin");
    });

    it("is case-insensitive", () => {
        expect(scriptProfileForLocale("JA-JP").id).toBe("japanese");
        expect(scriptProfileForLocale("ZH-HANT").id).toBe("chinese-traditional");
    });
});

describe("suggestLocalesForCoverage", () => {
    const CJK_PROJECT = ["en", "ja", "zh-Hans"];

    it("suggests the language whose code page the font declares", () => {
        expect(suggestLocalesForCoverage(font([1252, 932], KANA), CJK_PROJECT)).toEqual(["ja"]);
        expect(suggestLocalesForCoverage(font([1252, 936]), CJK_PROJECT)).toEqual(["zh-Hans"]);
    });

    it("says nothing about a pan-CJK font that declares both", () => {
        expect(suggestLocalesForCoverage(font([932, 936], KANA), CJK_PROJECT)).toEqual([]);
    });

    it("never suggests a Latin language, however much Latin the font has", () => {
        expect(suggestLocalesForCoverage(font([1252], LATIN), CJK_PROJECT)).toEqual([]);
        expect(suggestLocalesForCoverage(font([1252], LATIN), ["en", "fr", "de"])).toEqual([]);
    });

    it("will not guess between Han languages from the repertoire alone", () => {
        // Every kana and kanji the Japanese profile probes for, and no declaration at all: a
        // Simplified Chinese face carries the same characters, so this is not evidence.
        expect(suggestLocalesForCoverage(font([], KANA), CJK_PROJECT)).toEqual([]);
    });

    it("does read the repertoire for scripts that cannot be confused", () => {
        const project = ["en", "ko", "th"];
        expect(suggestLocalesForCoverage(font([], HANGUL), project)).toEqual(["ko"]);
        expect(suggestLocalesForCoverage(font([], THAI), project)).toEqual(["th"]);
        expect(suggestLocalesForCoverage(font([], [...HANGUL, ...THAI]), project)).toEqual([]);
    });

    it("treats a font that declared some code pages as having declined the rest", () => {
        // Hangul in the repertoire but 1252 alone declared: the vendor said what this is for, and
        // a `cmap` reading must not overturn it.
        expect(suggestLocalesForCoverage(font([1252], HANGUL), ["en", "ko", "th"])).toEqual([]);
    });

    it("says nothing when the project has fewer than two writing systems to choose between", () => {
        expect(suggestLocalesForCoverage(font([932], KANA), ["en", "ja"])).toEqual([]);
        expect(suggestLocalesForCoverage(font([932], KANA), ["ja"])).toEqual([]);
        expect(suggestLocalesForCoverage(font([932], KANA), [])).toEqual([]);
    });

    it("returns every project language that shares the named writing system", () => {
        expect(suggestLocalesForCoverage(font([936]), ["ja", "zh-Hans", "zh-SG"]))
            .toEqual(["zh-Hans", "zh-SG"]);
    });
});
