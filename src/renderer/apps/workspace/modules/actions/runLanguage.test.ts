import { describe, expect, it } from "vitest";
import type { LocalizationConfiguration } from "@shared/types/localization";
import { isRunLocaleChoiceGone, readRunLocaleChoice, runLanguageOptions, writeRunLocaleChoice } from "./runLanguage";

const TWO: LocalizationConfiguration = {
    sourceLocale: "zh-CN",
    locales: [
        { code: "en", displayName: "English" },
        { code: "zh-CN", displayName: "简体中文" },
        { code: "ja", displayName: "日本語" },
    ],
};

describe("runLanguageOptions", () => {
    it("lists the project's languages by their display names, source language first", () => {
        expect(runLanguageOptions(TWO)).toEqual([
            { code: "zh-CN", displayName: "简体中文" },
            { code: "en", displayName: "English" },
            { code: "ja", displayName: "日本語" },
        ]);
    });

    it("hides the row for a project with one language or none", () => {
        expect(runLanguageOptions({ sourceLocale: "en", locales: [{ code: "en", displayName: "English" }] })).toBeNull();
        expect(runLanguageOptions({ sourceLocale: "", locales: [] })).toBeNull();
        expect(runLanguageOptions(null)).toBeNull();
    });

    it("hides the row for a project that reads only its keys", () => {
        expect(runLanguageOptions({ ...TWO, sourceLocale: "" })).toBeNull();
    });
});

describe("the stored choice", () => {
    it("round-trips per project and deletes the entry for the default", () => {
        const written = writeRunLocaleChoice({ other: "ja" }, "rain", "en");
        expect(written).toEqual({ other: "ja", rain: "en" });
        expect(readRunLocaleChoice(written, "rain")).toBe("en");

        const cleared = writeRunLocaleChoice(written, "rain", null);
        expect(cleared).toEqual({ other: "ja" });
        expect(readRunLocaleChoice(cleared, "rain")).toBeNull();
    });

    it("finds a choice whose language the project lost, even with the row hidden", () => {
        const one: LocalizationConfiguration = { sourceLocale: "zh-CN", locales: [{ code: "zh-CN", displayName: "简体中文" }] };
        expect(isRunLocaleChoiceGone("ja", one)).toBe(true);
        expect(isRunLocaleChoiceGone("ja", TWO)).toBe(false);
        expect(isRunLocaleChoiceGone(null, one)).toBe(false);
    });
});
