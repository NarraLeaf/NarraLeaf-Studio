import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "./translator";
import { getLocaleMeta, getRegisteredLocales, isRegisteredLocale, normalizeLocale } from "./locales";
import { setLocaleContributions } from "./registry";

// A key the en catalog defines (built-in-satisfied for en and zh).
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
                pluginId: "acme.ja-pack",
                code: "ja",
                meta: { nativeName: "日本語", intl: "ja-JP" },
                messages: { [BUILTIN_KEY]: "一般" },
            },
        ]);

        expect(isRegisteredLocale("ja")).toBe(true);
        expect(getRegisteredLocales()).toContain("ja");
        expect(getLocaleMeta("ja").nativeName).toBe("日本語");
        expect(getLocaleMeta("ja").intl).toBe("ja-JP");

        const { t } = createTranslator("ja");
        expect(t(BUILTIN_KEY)).toBe("一般");
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
            { pluginId: "acme.ja-pack", code: "ja", meta: { nativeName: "日本語" }, messages: { [BUILTIN_KEY]: "一般" } },
        ]);
        expect(createTranslator("ja").t(BUILTIN_KEY)).toBe("一般");

        // Re-register with a different value; the cached flat map must be rebuilt.
        setLocaleContributions([
            { pluginId: "acme.ja-pack", code: "ja", meta: { nativeName: "日本語" }, messages: { [BUILTIN_KEY]: "設定" } },
        ]);
        expect(createTranslator("ja").t(BUILTIN_KEY)).toBe("設定");

        // Removing the pack reverts: ja is no longer registered.
        reset();
        expect(isRegisteredLocale("ja")).toBe(false);
        expect(getRegisteredLocales()).not.toContain("ja");
    });

    it("resolves plugin-vs-plugin collisions last-wins with a warning", () => {
        const onWarn = vi.fn();
        setLocaleContributions(
            [
                { pluginId: "acme.first", code: "ja", meta: { nativeName: "日本語" }, messages: { [BUILTIN_KEY]: "First" } },
                { pluginId: "acme.second", code: "ja", messages: { [BUILTIN_KEY]: "Second" } },
            ],
            { onWarn },
        );

        expect(createTranslator("ja").t(BUILTIN_KEY)).toBe("Second");
        expect(onWarn).toHaveBeenCalledTimes(1);
    });

    it("normalizeLocale preserves a registered locale and degrades when it is gone", () => {
        setLocaleContributions([
            { pluginId: "acme.ja-pack", code: "ja", meta: { nativeName: "日本語" }, messages: { [BUILTIN_KEY]: "一般" } },
        ]);
        expect(normalizeLocale("ja")).toBe("ja");

        reset();
        // Provider removed: the persisted value degrades to the fallback.
        expect(normalizeLocale("ja")).toBe("en");
    });
});
