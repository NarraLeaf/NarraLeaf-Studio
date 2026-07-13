import { describe, expect, it } from "vitest";
import { createTranslator } from "./translator";
import { normalizeLocale } from "./locales";

describe("createTranslator", () => {
    it("returns the source string for the source locale", () => {
        const { t } = createTranslator("en");
        expect(t("settings.categories.general.label")).toBe("General");
    });

    it("returns the translated string for a translated locale", () => {
        const { t } = createTranslator("zh");
        expect(t("settings.categories.general.label")).toBe("常规");
    });

    it("interpolates named placeholders", () => {
        const { tn } = createTranslator("en");
        expect(tn("launcher.recentCount", 1)).toBe("1 recent project");
        expect(tn("launcher.recentCount", 5)).toBe("5 recent projects");
    });

    it("selects the single plural form for Chinese", () => {
        const { tn } = createTranslator("zh");
        expect(tn("launcher.recentCount", 1)).toBe("1 个最近项目");
        expect(tn("launcher.recentCount", 5)).toBe("5 个最近项目");
    });

    it("falls back to the source locale for keys missing in a partial locale", () => {
        const { t } = createTranslator("zh");
        // Chinese has a single plural form, so zh omits the English `.one` form;
        // resolving it falls back to English.
        expect(t("launcher.recentCount.one")).toBe("{count} recent project");
        // A key zh does translate still returns Chinese.
        expect(t("settings.categories.general.label")).toBe("常规");
    });

    it("returns the key itself for an unknown key", () => {
        const { t } = createTranslator("en");
        // @ts-expect-error — unknown keys are a type error; runtime is defensive.
        expect(t("does.not.exist")).toBe("does.not.exist");
    });

    it("reports key availability via has()", () => {
        const { has } = createTranslator("en");
        expect(has("common.ok")).toBe(true);
        expect(has("nope.nope")).toBe(false);
    });

    it("formats numbers/dates for the active locale", () => {
        expect(createTranslator("en").formatNumber(1234.5)).toBe("1,234.5");
        const date = new Date(Date.UTC(2026, 0, 8));
        const formatted = createTranslator("zh").formatDate(date, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
        expect(formatted).toContain("2026");
    });
});

describe("normalizeLocale", () => {
    it("passes supported locales through", () => {
        expect(normalizeLocale("zh")).toBe("zh");
    });

    it("matches region-tagged inputs on their primary subtag", () => {
        expect(normalizeLocale("zh-CN")).toBe("zh");
        expect(normalizeLocale("en_GB")).toBe("en");
    });

    it("falls back to the default for unknown/garbage input", () => {
        expect(normalizeLocale("fr")).toBe("en");
        expect(normalizeLocale(undefined)).toBe("en");
        expect(normalizeLocale(42)).toBe("en");
    });
});
