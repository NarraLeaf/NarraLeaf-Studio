/**
 * Studio's own words a player reads follow the game's language, walk the project's fallback chain,
 * and end at the project's source language - never at English by default.
 *
 * Comments in English per project convention.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { GameLocalizationBundle } from "@shared/types/localization";
import { playerWordsLocale, translateForPlayer, translatePlayerWords } from "./playerWords";
import { setRuntimeLocaleSource } from "./runtimeLocale";

const chineseProject: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> = {
    sourceLocale: "zh",
    locales: [
        { code: "zh", displayName: "中文" },
        { code: "en", displayName: "English" },
        { code: "ja", displayName: "日本語" },
        // A language Studio has no words in, falling back to one it has.
        { code: "ko", displayName: "한국어", fallback: "ja" },
        // And one with no fallback of its own.
        { code: "fr", displayName: "Français" },
    ],
};

describe("playerWordsLocale", () => {
    it("answers the language the game is being read in when Studio has words in it", () => {
        expect(playerWordsLocale(chineseProject, "zh")).toBe("zh");
        expect(playerWordsLocale(chineseProject, "ja")).toBe("ja");
        expect(playerWordsLocale(chineseProject, "en")).toBe("en");
    });

    it("reads a game with no language chosen in its source language", () => {
        expect(playerWordsLocale(chineseProject, "")).toBe("zh");
        expect(playerWordsLocale(chineseProject, undefined)).toBe("zh");
    });

    it("walks the project's fallback chain before the source language", () => {
        expect(playerWordsLocale(chineseProject, "ko")).toBe("ja");
    });

    it("ends at the source language, not English, for a language Studio has no words in", () => {
        expect(playerWordsLocale(chineseProject, "fr")).toBe("zh");
        expect(playerWordsLocale(chineseProject, "de")).toBe("zh");
    });

    it("matches a regional project language to Studio's catalogue", () => {
        expect(playerWordsLocale({ sourceLocale: "zh-CN", locales: [{ code: "zh-CN", displayName: "简体中文" }] }, "zh-CN")).toBe("zh");
        expect(playerWordsLocale({ sourceLocale: "ja-JP", locales: [{ code: "ja-JP", displayName: "日本語" }] }, "")).toBe("ja");
    });

    it("has no answer for a project without a language, or with none Studio has words in", () => {
        expect(playerWordsLocale({ sourceLocale: "", locales: [] }, "ja")).toBeNull();
        expect(playerWordsLocale({ sourceLocale: "fr", locales: [{ code: "fr", displayName: "Français" }] }, "fr")).toBeNull();
    });
});

describe("translatePlayerWords", () => {
    it("words a key in the language chosen", () => {
        expect(translatePlayerWords("zh", "widgets.frame.missingPage")).toBe("缺少页面");
        expect(translatePlayerWords("ja", "widgets.frame.missingPage")).toBe("ページが見つからない");
        expect(translatePlayerWords("en", "widgets.frame.missingPage")).toBe("Missing Page");
    });

    it("falls back to the interface's translator when no language was chosen", () => {
        // The test environment's interface language is the default one.
        expect(translatePlayerWords(null, "widgets.frame.missingPage")).toBe("Missing Page");
    });
});

describe("translateForPlayer", () => {
    let release: (() => void) | null = null;
    afterEach(() => {
        release?.();
        release = null;
    });

    it("reads the running game's language at the moment of the call", () => {
        let locale = "ja";
        release = setRuntimeLocaleSource({ getLocale: () => locale, sourceLocale: "zh", locales: chineseProject.locales });
        expect(translateForPlayer("game.saveLoad.refused")).toBe("このセーブは読み込めなかった。ゲームは現在の位置から続く");
        locale = "zh";
        expect(translateForPlayer("game.saveLoad.refused")).toBe("该存档无法读取。游戏从当前位置继续。");
        locale = "ko";
        expect(translateForPlayer("widgets.frame.missingPage")).toBe("ページが見つからない");
    });

    it("is the interface's translator outside a running game", () => {
        expect(translateForPlayer("widgets.frame.missingPage")).toBe("Missing Page");
    });
});
