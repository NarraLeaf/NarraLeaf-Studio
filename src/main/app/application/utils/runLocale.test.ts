import { describe, expect, it } from "vitest";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { readRunLocaleChoice, resolveRunLocale, RUN_LOCALE_SETTINGS_KEY } from "./runLocale";

/**
 * The language a Dev Mode run is shown in, read from the machine's own settings.
 *
 * The case worth pinning is the language that is gone: the author asked for it, so the run is
 * refused rather than shown in some other language that would look like a broken translation.
 */

const PROJECT = "D:/Games/Rain";
const LOCALIZATION = {
    locales: [
        { code: "zh-CN", displayName: "简体中文" },
        { code: "en", displayName: "English" },
    ],
};

function settings(value: unknown) {
    return { get: (key: string) => (key === RUN_LOCALE_SETTINGS_KEY ? value : undefined) };
}

describe("readRunLocaleChoice", () => {
    it("answers the language this machine picked for this project", () => {
        expect(readRunLocaleChoice(settings({ [normalizeProjectPath(PROJECT)]: "en" }), PROJECT)).toBe("en");
    });

    it("finds it under either spelling of the path", () => {
        const stored = settings({ [normalizeProjectPath("D:\\Games\\Rain")]: "en" });
        expect(readRunLocaleChoice(stored, PROJECT)).toBe("en");
    });

    it("answers none for no setting, another project, or a malformed value", () => {
        expect(readRunLocaleChoice(settings(undefined), PROJECT)).toBeNull();
        expect(readRunLocaleChoice(settings({ [normalizeProjectPath("D:/Other")]: "en" }), PROJECT)).toBeNull();
        expect(readRunLocaleChoice(settings({ [normalizeProjectPath(PROJECT)]: 3 }), PROJECT)).toBeNull();
        expect(readRunLocaleChoice(settings(["en"]), PROJECT)).toBeNull();
    });
});

describe("resolveRunLocale", () => {
    it("leaves the language to the game when none was chosen", () => {
        expect(resolveRunLocale(null, LOCALIZATION)).toEqual({ kind: "none" });
    });

    it("pins a language the project has", () => {
        expect(resolveRunLocale("en", LOCALIZATION)).toEqual({ kind: "pinned", code: "en" });
    });

    it("reports a language the project no longer has instead of dropping it", () => {
        expect(resolveRunLocale("ja", LOCALIZATION)).toEqual({ kind: "missing", code: "ja" });
        expect(resolveRunLocale("ja", undefined)).toEqual({ kind: "missing", code: "ja" });
    });
});
