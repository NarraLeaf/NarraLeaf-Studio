import { describe, expect, it } from "vitest";
import { planLanguageChange } from "./tools/projectTools";

/**
 * `project_settings_set`'s language rules: the source language never leaves, and a language that
 * holds translations leaves only when `removeLanguages` names it - never because a list omitted it.
 */

const current = { sourceLocale: "zh-CN", locales: ["zh-CN", "en", "ja"] };
const translated = (counts: Record<string, number>) => (code: string) => counts[code] ?? 0;

describe("planLanguageChange", () => {
    it("drops untranslated languages a list leaves out and adds the new ones", () => {
        expect(planLanguageChange(current, ["zh-CN", "fr"], [], translated({}))).toEqual({ add: ["fr"], remove: ["en", "ja"] });
    });

    it("refuses to drop a translated language by omission, naming it and how many lines it holds", () => {
        expect(() => planLanguageChange(current, ["zh-CN"], [], translated({ en: 28 })))
            .toThrow(expect.objectContaining({ code: "invalid_args", message: expect.stringMatching(/en \(28 translated lines\)/) }));
        expect(planLanguageChange(current, ["zh-CN"], ["en"], translated({ en: 28 }))).toEqual({ add: [], remove: ["en", "ja"] });
    });

    it("removes what removeLanguages names without a full list", () => {
        expect(planLanguageChange(current, undefined, ["ja"], translated({ ja: 3 }))).toEqual({ add: [], remove: ["ja"] });
    });

    it("never removes the source language", () => {
        expect(() => planLanguageChange(current, undefined, ["zh-CN"], translated({}))).toThrow(/source language/);
        expect(() => planLanguageChange(current, ["en"], [], translated({}))).toThrow(/leaves out zh-CN/);
    });

    it("refuses codes that are not languages and a language both kept and removed", () => {
        expect(() => planLanguageChange(current, ["zh-CN", "nope nope"], [], translated({}))).toThrow(/not a language code/);
        expect(() => planLanguageChange(current, ["zh-CN", "en"], ["en"], translated({}))).toThrow(/both/);
    });

    it("changes nothing when the list is what the project has", () => {
        expect(planLanguageChange(current, ["zh-CN", "en", "ja"], [], translated({ en: 1 }))).toEqual({ add: [], remove: [] });
    });
});
