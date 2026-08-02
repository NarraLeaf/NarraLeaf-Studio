import { afterEach, describe, expect, it } from "vitest";
import { commandI18nStore, i18nStore } from "@/lib/i18n";
import { LOCALIZED_COMMANDS_DEFAULT } from "@/lib/settings/commandLanguageOptions";
import { parseCommandLine } from "../storyCommandParser";
import { getCommandDef, listCommandDefs, localizedCommandToken } from "./registry";

/**
 * What the candidate menu drops into the line when a command is picked.
 *
 * The menu showed "隐藏" and the line received "@hide": one pick, two words, so the author could not
 * learn what to type by using the menu — the thing they chose never appeared. These tests hold the
 * loop closed in the only way that matters: whatever the menu inserts has to parse back to the very
 * command that was picked, in every locale and with the setting either way.
 */

afterEach(() => {
    commandI18nStore.setPreference(LOCALIZED_COMMANDS_DEFAULT);
    i18nStore.setLocale("en");
});

/** The line a pick produces, parsed — exactly as `chooseCommandCandidate` assembles it. */
function pickAndParse(token: string, trigger: "/" | "@" = "/") {
    const line = parseCommandLine(`${trigger}${token} `.replace("@", "/"));
    if (line.kind !== "command") {
        throw new Error(`expected a command line, got ${line.kind}`);
    }
    return line;
}

describe("localizedCommandToken", () => {
    it("drops the word the menu is showing", () => {
        i18nStore.setLocale("zh");
        expect(localizedCommandToken(getCommandDef("hide")!)).toBe("隐藏");
        expect(localizedCommandToken(getCommandDef("show")!)).toBe("显示");
        expect(localizedCommandToken(getCommandDef("bg")!)).toBe("背景");
    });

    it("stays canonical English when the vocabulary is not translated", () => {
        i18nStore.setLocale("en");
        expect(localizedCommandToken(getCommandDef("hide")!)).toBe("hide");

        // And when the author has switched the vocabulary off, a Chinese interface still types English.
        i18nStore.setLocale("zh");
        commandI18nStore.setPreference(false);
        expect(localizedCommandToken(getCommandDef("hide")!)).toBe("hide");
    });

    it("only ever drops a word the parser takes back — every command, every locale", () => {
        // The invariant the whole feature rests on. A label that fell foul of a drop rule (blank,
        // untranslated, multi-word, or already spelling another command's canonical token) must come
        // back as the English token rather than as a word the line cannot read.
        for (const locale of ["en", "zh"] as const) {
            i18nStore.setLocale(locale);
            for (const def of listCommandDefs()) {
                const token = localizedCommandToken(def);
                expect(token, `${def.token} in ${locale} drops an empty token`).not.toBe("");
                expect(/\s/.test(token), `${def.token} in ${locale} drops "${token}", which is not one token`).toBe(false);
                const parsed = pickAndParse(token);
                expect(parsed.def?.commandId, `${locale}: "${token}" parsed back to a different command`).toBe(def.commandId);
            }
        }
    });

    it("follows a language change without a keystroke", () => {
        const hide = getCommandDef("hide")!;
        i18nStore.setLocale("en");
        expect(localizedCommandToken(hide)).toBe("hide");
        i18nStore.setLocale("zh");
        expect(localizedCommandToken(hide)).toBe("隐藏");
        i18nStore.setLocale("en");
        expect(localizedCommandToken(hide)).toBe("hide");
    });
});
