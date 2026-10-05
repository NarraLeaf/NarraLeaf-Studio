import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "./translator";
import { getLocaleMeta, getRegisteredLocales, isRegisteredLocale, matchCatalogLocale, normalizeLocale, resolvePreferredLocale } from "./locales";
import { setLocaleContributions } from "./registry";

// A key the en catalog defines (built-in-satisfied in every built-in locale).
const BUILTIN_KEY = "settings.categories.general.label";
// A key zh omits (English-only `.one` plural form), so zh can be filled.
const ZH_GAP_KEY = "launcher.recentCount.one";

function reset() {
    // Clear the overlay between tests; also bumps the version so the translator's
    // flatCache re-flattens from the baseline.
    setLocaleContributions([]);
}

describe("locale registry", () => {
    beforeEach(reset);
    afterEach(reset);

    it("adds a brand-new locale that the translator can resolve", () => {
        setLocaleContributions([
            {
                pluginId: "acme.ko-pack",
                code: "ko",
                meta: { nativeName: "한국어", intl: "ko-KR" },
                messages: { [BUILTIN_KEY]: "일반" },
            },
        ]);

        expect(isRegisteredLocale("ko")).toBe(true);
        expect(getRegisteredLocales()).toContain("ko");
        expect(getLocaleMeta("ko").nativeName).toBe("한국어");
        expect(getLocaleMeta("ko").intl).toBe("ko-KR");

        const { t } = createTranslator("ko");
        expect(t(BUILTIN_KEY)).toBe("일반");
        // Keys the pack lacks fall back to the source locale (en).
        expect(t("common.ok")).toBe(createTranslator("en").t("common.ok"));
    });

    it("fills a gap in a built-in locale without a warning", () => {
        const onWarn = vi.fn();
        // zh omits `launcher.recentCount.one`, so this is a fill, not an override.
        expect(createTranslator("zh").t(ZH_GAP_KEY)).toBe(createTranslator("en").t(ZH_GAP_KEY));

        setLocaleContributions(
            [{ pluginId: "acme.zh-fill", code: "zh", messages: { [ZH_GAP_KEY]: "一个最近项目" } }],
            { onWarn },
        );

        expect(createTranslator("zh").t(ZH_GAP_KEY)).toBe("一个最近项目");
        expect(onWarn).not.toHaveBeenCalled();
    });

    it("refuses to override a built-in-satisfied key and warns", () => {
        const onWarn = vi.fn();
        setLocaleContributions(
            [{ pluginId: "acme.evil", code: "en", messages: { [BUILTIN_KEY]: "Hijacked" } }],
            { onWarn },
        );

        // Built-in wins; the override is ignored.
        expect(createTranslator("en").t(BUILTIN_KEY)).toBe("General");
        expect(onWarn).toHaveBeenCalledTimes(1);
        expect(onWarn.mock.calls[0][0]).toContain("override");
    });

    it("invalidates the translator cache when contributions change", () => {
        setLocaleContributions([
            { pluginId: "acme.ko-pack", code: "ko", meta: { nativeName: "한국어" }, messages: { [BUILTIN_KEY]: "일반" } },
        ]);
        expect(createTranslator("ko").t(BUILTIN_KEY)).toBe("일반");

        // Re-register with a different value; the cached flat map must be rebuilt.
        setLocaleContributions([
            { pluginId: "acme.ko-pack", code: "ko", meta: { nativeName: "한국어" }, messages: { [BUILTIN_KEY]: "설정" } },
        ]);
        expect(createTranslator("ko").t(BUILTIN_KEY)).toBe("설정");

        // Removing the pack reverts: ko is no longer registered.
        reset();
        expect(isRegisteredLocale("ko")).toBe(false);
        expect(getRegisteredLocales()).not.toContain("ko");
    });

    it("resolves plugin-vs-plugin collisions last-wins with a warning", () => {
        const onWarn = vi.fn();
        setLocaleContributions(
            [
                { pluginId: "acme.first", code: "ko", meta: { nativeName: "한국어" }, messages: { [BUILTIN_KEY]: "First" } },
                { pluginId: "acme.second", code: "ko", messages: { [BUILTIN_KEY]: "Second" } },
            ],
            { onWarn },
        );

        expect(createTranslator("ko").t(BUILTIN_KEY)).toBe("Second");
        expect(onWarn).toHaveBeenCalledTimes(1);
    });

    it("normalizeLocale preserves a registered locale and degrades when it is gone", () => {
        setLocaleContributions([
            { pluginId: "acme.ko-pack", code: "ko", meta: { nativeName: "한국어" }, messages: { [BUILTIN_KEY]: "일반" } },
        ]);
        expect(normalizeLocale("ko")).toBe("ko");

        reset();
        // Provider removed: the persisted value degrades to the fallback.
        expect(normalizeLocale("ko")).toBe("en");
    });
});

describe("the language a machine that never chose one is shown", () => {
    beforeEach(reset);
    afterEach(reset);

    function contribute(code: string, intl?: string) {
        setLocaleContributions([
            {
                pluginId: `acme.${code}`,
                code,
                ...(intl ? { meta: { nativeName: code, intl } } : {}),
                messages: { [BUILTIN_KEY]: code },
            },
        ]);
    }

    it("finds a Traditional Chinese pack whichever way the machine and the pack spell it", () => {
        contribute("zh-Hant");
        expect(resolvePreferredLocale(["zh-TW", "en-US"])).toBe("zh-Hant");
        expect(resolvePreferredLocale(["zh-HK"])).toBe("zh-Hant");
        contribute("zh-TW");
        expect(resolvePreferredLocale(["zh-Hant-TW"])).toBe("zh-TW");
        expect(resolvePreferredLocale(["zh-Hant"])).toBe("zh-TW");
    });

    it("keeps the built-in language for a reader it serves, pack or no pack", () => {
        contribute("zh-Hans");
        expect(resolvePreferredLocale(["zh-CN"])).toBe("zh");
        contribute("ja-JP");
        expect(resolvePreferredLocale(["ja-JP"])).toBe("ja");
    });

    it("reads the tag a pack declares for Intl as one it answers to", () => {
        contribute("ko-x-formal", "ko-KR");
        expect(resolvePreferredLocale(["ko-KR"])).toBe("ko-x-formal");
    });

    it("still shows Chinese to a Traditional reader when no Traditional pack is installed", () => {
        expect(resolvePreferredLocale(["zh-TW"])).toBe("zh");
    });

    it("says when no catalogue serves a language, where the default would otherwise answer", () => {
        expect(matchCatalogLocale(["fr-FR"])).toBeNull();
        expect(resolvePreferredLocale(["fr-FR"])).toBe("en");
        expect(matchCatalogLocale(["zh-CN"])).toBe("zh");
        contribute("ko-x-formal", "ko-KR");
        expect(matchCatalogLocale(["ko"])).toBe("ko-x-formal");
    });
});
