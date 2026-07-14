import { describe, expect, it } from "vitest";
import type { StoryTextSegment } from "../types/story/document";
import {
    countSegmentInterpolations,
    hashSourceText,
    isSourceHashStale,
    parseTranslatedText,
    serializeSegmentSourceText,
} from "./localizationText";
import {
    matchSystemLocale,
    normalizeLocalizationConfiguration,
    normalizeLocalizationDocument,
    resolveLocaleChain,
} from "../types/localization";

function segment(partial: Partial<StoryTextSegment>): StoryTextSegment {
    return {
        textId: "text-1",
        value: "",
        role: "dialogue",
        ...partial,
    };
}

describe("serializeSegmentSourceText", () => {
    it("returns the plain value for segments without rich runs", () => {
        expect(serializeSegmentSourceText(segment({ value: "Hello" }))).toBe("Hello");
    });

    it("concatenates text runs and numbers interpolations, skipping pauses", () => {
        const source = segment({
            value: "ignored projection",
            rich: [
                { text: "Hi, " },
                { interpolation: { kind: "variable", target: { scope: "persistent", storageKey: "name" } } },
                { pause: true },
                { text: "! Score: ", marks: { bold: true } },
                { interpolation: { kind: "blueprint", blueprintId: "bp-1" } },
            ],
        });
        expect(serializeSegmentSourceText(source)).toBe("Hi, {0}! Score: {1}");
        expect(countSegmentInterpolations(source)).toBe(2);
    });

    it("does not change when only marks change (styling must not invalidate translations)", () => {
        const plain = segment({ rich: [{ text: "Stop" }] });
        const bold = segment({ rich: [{ text: "Stop", marks: { bold: true } }] });
        expect(serializeSegmentSourceText(plain)).toBe(serializeSegmentSourceText(bold));
    });
});

describe("source hash staleness", () => {
    it("matches for identical text and differs after an edit", () => {
        const hash = hashSourceText("Hello");
        expect(isSourceHashStale(hash, "Hello")).toBe(false);
        expect(isSourceHashStale(hash, "Hello!")).toBe(true);
    });
});

describe("parseTranslatedText", () => {
    it("splits literal chunks and numbered placeholders", () => {
        expect(parseTranslatedText("你好，{0}！得分 {1}")).toEqual([
            { kind: "text", text: "你好，" },
            { kind: "placeholder", index: 0 },
            { kind: "text", text: "！得分 " },
            { kind: "placeholder", index: 1 },
        ]);
    });

    it("passes through text without placeholders", () => {
        expect(parseTranslatedText("plain")).toEqual([{ kind: "text", text: "plain" }]);
    });

    it("ignores non-numeric braces", () => {
        expect(parseTranslatedText("{name} {0}")).toEqual([
            { kind: "text", text: "{name} " },
            { kind: "placeholder", index: 0 },
        ]);
    });
});

describe("normalizeLocalizationConfiguration", () => {
    it("returns the disabled default for malformed input", () => {
        expect(normalizeLocalizationConfiguration(undefined)).toEqual({ sourceLocale: "", locales: [] });
        expect(normalizeLocalizationConfiguration("nope")).toEqual({ sourceLocale: "", locales: [] });
    });

    it("drops invalid codes, duplicates, and self-fallbacks; clears unknown source", () => {
        const normalized = normalizeLocalizationConfiguration({
            sourceLocale: "missing",
            locales: [
                { code: "zh-CN", displayName: "简体中文" },
                { code: "zh-CN", displayName: "dup" },
                { code: "bad code", displayName: "x" },
                { code: "en", displayName: "  ", fallback: "en" },
                { code: "ja", displayName: "日本語", fallback: "en" },
            ],
        });
        expect(normalized.sourceLocale).toBe("");
        expect(normalized.locales).toEqual([
            { code: "zh-CN", displayName: "简体中文" },
            { code: "en", displayName: "en" },
            { code: "ja", displayName: "日本語", fallback: "en" },
        ]);
    });

    it("keeps a valid source that exists in the locale list", () => {
        const normalized = normalizeLocalizationConfiguration({
            sourceLocale: "zh-CN",
            locales: [{ code: "zh-CN", displayName: "简体中文" }],
        });
        expect(normalized.sourceLocale).toBe("zh-CN");
    });
});

describe("normalizeLocalizationDocument", () => {
    it("degrades malformed input to an empty document", () => {
        const document = normalizeLocalizationDocument(null, "en");
        expect(document.locale).toBe("en");
        expect(document.units).toEqual({});
    });

    it("keeps valid units and drops malformed ones", () => {
        const document = normalizeLocalizationDocument({
            units: {
                a: { target: "Hello", sourceHash: "fnv1a:1", status: "translated", note: "n" },
                b: { target: 42 },
                c: { target: "Hi", status: "bogus" },
            },
        }, "en");
        expect(document.units).toEqual({
            a: { target: "Hello", sourceHash: "fnv1a:1", status: "translated", note: "n" },
            c: { target: "Hi", sourceHash: "", status: "untranslated" },
        });
    });
});

describe("matchSystemLocale", () => {
    const locales = [
        { code: "zh-CN", displayName: "简体中文" },
        { code: "en", displayName: "English" },
        { code: "pt-BR", displayName: "Português (Brasil)" },
    ];

    it("prefers an exact match (case-insensitive) across all candidates", () => {
        expect(matchSystemLocale(locales, ["fr-FR", "ZH-cn"])).toBe("zh-CN");
    });

    it("falls back to prefix matches in both directions", () => {
        expect(matchSystemLocale(locales, ["en-US"])).toBe("en");
        expect(matchSystemLocale(locales, ["pt"])).toBe("pt-BR");
    });

    it("returns null when nothing matches", () => {
        expect(matchSystemLocale(locales, ["ja-JP", "ko"])).toBeNull();
        expect(matchSystemLocale(locales, [])).toBeNull();
    });
});

describe("resolveLocaleChain", () => {
    const config = {
        sourceLocale: "zh-CN",
        locales: [
            { code: "zh-CN", displayName: "简体中文" },
            { code: "zh-TW", displayName: "繁體中文", fallback: "zh-CN" },
            { code: "yue", displayName: "粵語", fallback: "zh-TW" },
            { code: "a", displayName: "a", fallback: "b" },
            { code: "b", displayName: "b", fallback: "a" },
        ],
    };

    it("walks fallbacks and stops before the source locale", () => {
        expect(resolveLocaleChain(config, "yue")).toEqual(["yue", "zh-TW"]);
    });

    it("is cycle-safe", () => {
        expect(resolveLocaleChain(config, "a")).toEqual(["a", "b"]);
    });

    it("returns empty for the source locale itself", () => {
        expect(resolveLocaleChain(config, "zh-CN")).toEqual([]);
    });
});
