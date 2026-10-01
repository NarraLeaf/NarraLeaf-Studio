import { describe, expect, it } from "vitest";
import { matchPreferredLocale, normalizeLanguageTags, pickPreferredLocale } from "./preferredLocale";

const THREE = ["en", "zh", "ja"] as const;

describe("normalizeLanguageTags", () => {
    it("folds case and the underscore spelling some Linux setups produce", () => {
        expect(normalizeLanguageTags(["zh_CN", "en-US"])).toEqual(["zh-cn", "en-us"]);
    });

    it("drops empty and absent entries rather than matching on them", () => {
        expect(normalizeLanguageTags(["", null, undefined, "ja"])).toEqual(["ja"]);
    });
});

describe("pickPreferredLocale", () => {
    it("takes the first entry the offer can satisfy, not the first entry", () => {
        // A machine that asked for French and then Japanese has said something about Japanese.
        expect(pickPreferredLocale(["fr-FR", "ja-JP"], THREE, "en")).toBe("ja");
    });

    it("matches a region-tagged preference on its primary subtag", () => {
        expect(pickPreferredLocale(["zh-Hans-CN"], THREE, "en")).toBe("zh");
    });

    it("prefers a whole-tag match over the primary subtag", () => {
        expect(pickPreferredLocale(["zh-hant"], ["zh", "zh-hant"], "zh")).toBe("zh-hant");
    });

    it("falls back when nothing on the list is on offer", () => {
        expect(pickPreferredLocale(["fr", "de"], THREE, "en")).toBe("en");
        expect(pickPreferredLocale([], THREE, "en")).toBe("en");
    });
});

describe("matchPreferredLocale", () => {
    const BUILT_IN = [
        { code: "en", tags: ["en", "en-US"] },
        { code: "zh", tags: ["zh", "zh-CN"] },
        { code: "ja", tags: ["ja", "ja-JP"] },
    ];
    const pack = (code: string, intl?: string) => ({ code, tags: intl ? [code, intl] : [code] });
    const pick = (tags: string[], packs: { code: string; tags: string[] }[]) =>
        matchPreferredLocale(tags, [BUILT_IN, packs], "en");

    it.each([
        // A region names the script it is written in, and a script names every region that writes it.
        [["zh-TW"], [pack("zh-Hant")], "zh-Hant"],
        [["zh-HK"], [pack("zh-Hant")], "zh-Hant"],
        [["zh-Hant"], [pack("zh-TW")], "zh-TW"],
        [["zh-Hant-TW"], [pack("zh-Hant")], "zh-Hant"],
        [["zh-Hant-HK"], [pack("zh-TW")], "zh-TW"],
        [["zh_TW"], [pack("zh-hant")], "zh-hant"],
        // A pack registered under its region, reached from the bare language and from another region.
        [["fr"], [pack("fr-FR")], "fr-FR"],
        [["fr-CA"], [pack("fr-FR")], "fr-FR"],
        [["pt-BR"], [pack("pt")], "pt"],
        // The tag a pack hands to Intl answers for it too.
        [["ko-KR"], [pack("ko-x-formal", "ko-KR")], "ko-x-formal"],
    ])("finds %j in %j", (tags, packs, expected) => {
        expect(pick(tags, packs)).toBe(expected);
    });

    it("keeps the built-in language whenever it serves the reader's script", () => {
        expect(pick(["zh-CN"], [pack("zh-Hans"), pack("zh-x-neko", "zh-CN")])).toBe("zh");
        expect(pick(["zh-Hans-SG"], [pack("zh-Hans")])).toBe("zh");
        expect(pick(["zh"], [pack("zh-Hant")])).toBe("zh");
        expect(pick(["en-GB"], [pack("en-GB")])).toBe("en");
        expect(pick(["ja-JP"], [pack("ja-JP")])).toBe("ja");
    });

    it("settles for the built-in language in another script only when no pack is in the reader's", () => {
        expect(pick(["zh-TW"], [])).toBe("zh");
        expect(pick(["zh-TW"], [pack("zh-x-neko", "zh-CN")])).toBe("zh");
    });

    it("prefers a closer pack to a looser one", () => {
        expect(pick(["zh-TW"], [pack("zh-HK"), pack("zh-TW")])).toBe("zh-TW");
        expect(pick(["zh-Hant-TW"], [pack("zh-HK"), pack("zh-Hant")])).toBe("zh-Hant");
    });

    it("walks the list in order, every strength for one tag before the next", () => {
        // French first: a pack in another French is still French, and Japanese came second.
        expect(pick(["fr-CA", "ja"], [pack("fr-FR")])).toBe("fr-FR");
        expect(pick(["de", "zh-TW", "en"], [pack("zh-Hant")])).toBe("zh-Hant");
        expect(pick(["de", "it"], [pack("fr")])).toBe("en");
    });

    it("does not read a different language that shares a prefix as a match", () => {
        expect(pick(["zh-TW"], [pack("zha")])).toBe("zh");
        expect(pick(["fil"], [pack("fi")])).toBe("en");
    });
});
