import { describe, expect, it } from "vitest";
import { normalizeLanguageTags, pickPreferredLocale } from "./preferredLocale";

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
