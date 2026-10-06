import { afterEach, describe, expect, it } from "vitest";
import { commandI18nStore, i18nStore } from "@/lib/i18n";
import { LOCALIZED_COMMANDS_DEFAULT } from "@/lib/settings/commandLanguageOptions";
import {
    abbreviatedCommand,
    abbreviationsOf,
    checkAbbreviation,
    liveAbbreviations,
    resolveStoredAbbreviations,
    type StoryCommandAbbreviations,
} from "./storyCommandAbbreviations";
import { expandCommandAbbreviation } from "./storyCommandSpelling";
import { parseCommandLine } from "./storyCommandParser";
import { searchActionCommands } from "./storyCommandSearch";
import type { PaletteActionCommand } from "./storyActionCommands";

/**
 * The author's own abbreviations: `/c` for `/外观`.
 *
 * The property everything here protects is that an abbreviation is an input method and never a word
 * of the language. It is replaced on the line before anything is committed, so no row, no invalid
 * row and no exported script can hold a word that only one author's list can read - and the parser
 * itself is never told about one.
 */

afterEach(() => {
    commandI18nStore.setPreference(LOCALIZED_COMMANDS_DEFAULT);
    i18nStore.setLocale("en");
});

const list = (entries: Record<string, string>): StoryCommandAbbreviations => new Map(Object.entries(entries));

/** The line after expansion, or unchanged when nothing was expanded. */
function expand(value: string, abbreviations: StoryCommandAbbreviations, caret = value.length, settle = false): string {
    return expandCommandAbbreviation(value, caret, true, abbreviations, settle)?.value ?? value;
}

describe("resolveStoredAbbreviations", () => {
    it("folds words and drops malformed entries one at a time", () => {
        const resolved = resolveStoredAbbreviations({ C: "face", " bj ": "background", bad: 3, "": "show" });
        expect([...resolved]).toEqual([["c", "face"], ["bj", "background"]]);
    });

    it("reads anything that is not a record as an empty list", () => {
        expect(resolveStoredAbbreviations(undefined).size).toBe(0);
        expect(resolveStoredAbbreviations(["c"]).size).toBe(0);
        expect(resolveStoredAbbreviations("c").size).toBe(0);
    });
});

describe("checkAbbreviation", () => {
    it("accepts a free word, folded", () => {
        expect(checkAbbreviation(" C ", "face", list({}))).toEqual({ ok: true, word: "c" });
    });

    it("refuses spaces and the characters a line gives meaning to", () => {
        expect(checkAbbreviation("a b", "face", list({}))).toMatchObject({ ok: false, reason: "space" });
        for (const word of ["c=", "\"c", "'c", "c/", "@c", "#c"]) {
            expect(checkAbbreviation(word, "face", list({}))).toMatchObject({ ok: false, reason: "character" });
        }
        expect(checkAbbreviation("  ", "face", list({}))).toMatchObject({ ok: false, reason: "empty" });
    });

    it("refuses every word a command already answers to, in any language", () => {
        // The canonical token, an English alias, a spec id, and a label from a language the author
        // is not using: the last would start meaning the built-in the day the language is switched.
        for (const word of ["char", "face", "expr", "背景", "外观"]) {
            const check = checkAbbreviation(word, "show", list({}));
            expect(check).toMatchObject({ ok: false, reason: "builtIn" });
        }
        expect(i18nStore.getLocale()).toBe("en");
    });

    it("refuses a word that already abbreviates another command, and allows re-adding the same one", () => {
        const current = list({ c: "face" });
        const taken = checkAbbreviation("c", "show", current);
        expect(taken).toMatchObject({ ok: false, reason: "taken" });
        expect(taken.ok ? null : "def" in taken ? taken.def.commandId : null).toBe("face");
        expect(checkAbbreviation("c", "face", current)).toEqual({ ok: true, word: "c" });
    });

    it("lets a retired command's word be claimed: it never reaches a stored line", () => {
        expect(checkAbbreviation("move", "transform", list({}))).toEqual({ ok: true, word: "move" });
    });
});

describe("abbreviatedCommand", () => {
    it("names the command an abbreviation stands for", () => {
        expect(abbreviatedCommand("C", list({ c: "face" }))?.commandId).toBe("face");
    });

    it("never shadows a built-in spelling, and ignores a command that no longer exists", () => {
        // Neither can be created through checkAbbreviation; both can be in a list written by another
        // build, or before a later version took the word.
        expect(abbreviatedCommand("show", list({ show: "hide" }))).toBeNull();
        expect(abbreviatedCommand("x", list({ x: "noSuchCommand" }))).toBeNull();
        expect([...liveAbbreviations(list({ show: "hide", x: "noSuchCommand", c: "face" }))]).toEqual([["c", "face"]]);
    });

    it("lists one command's words shortest first", () => {
        expect(abbreviationsOf("face", list({ wg: "face", c: "face", bj: "background", ab: "face" }))).toEqual(["c", "ab", "wg"]);
    });
});

describe("expandCommandAbbreviation", () => {
    const abbreviations = list({ c: "face", move: "transform" });

    it("replaces a finished abbreviation with the command, in the command language", () => {
        expect(expand("/c ", abbreviations)).toBe("/char ");
        i18nStore.setLocale("zh");
        expect(expand("/c ", abbreviations)).toBe("/外观 ");
        expect(expand("@c ", abbreviations)).toBe("@外观 ");
        // The rewritten line parses as the command: nothing downstream sees the abbreviation.
        const line = parseCommandLine(expand("/c Alice", abbreviations, 8));
        expect(line.kind === "command" ? line.def?.commandId : null).toBe("face");
    });

    it("moves the caret past the replaced word", () => {
        i18nStore.setLocale("zh");
        expect(expandCommandAbbreviation("/c ", 3, true, abbreviations)).toEqual({ value: "/外观 ", caret: 4 });
    });

    it("waits while the caret is still on the word", () => {
        // At the end of `/c` the author may be typing `/cut`; in the middle of a line, the same.
        expect(expand("/c", abbreviations)).toBe("/c");
        expect(expand("/c Alice", abbreviations, 2)).toBe("/c Alice");
        expect(expand("/c Alice", abbreviations, 8)).toBe("/char Alice");
    });

    it("settles regardless of the caret on the commit path", () => {
        expect(expand("/c", abbreviations, 2, true)).toBe("/char");
        expect(expand("@c Alice", abbreviations, 2, true)).toBe("@char Alice");
    });

    it("leaves built-in spellings, other words, and other lines alone", () => {
        expect(expand("/show ", list({ show: "hide" }))).toBe("/show ");
        expect(expand("/cc ", abbreviations)).toBe("/cc ");
        expect(expand("c is narration ", abbreviations)).toBe("c is narration ");
        expect(expand("#c hello", abbreviations)).toBe("#c hello");
        expect(expandCommandAbbreviation("/c ", 3, true, list({}))).toBeNull();
    });

    it("can stand in for a retired command's word", () => {
        expect(expand("/move Alice pos=left", abbreviations, 20, true)).toBe("/transform Alice pos=left");
    });
});

describe("searchActionCommands with abbreviations", () => {
    const command = (id: string, label: string): PaletteActionCommand => ({ id, label, detail: "", group: "utils" } as unknown as PaletteActionCommand);
    const commands = [command("cut", "Cut"), command("text", "Text"), command("face", "Appearance")];

    it("puts the command an exact abbreviation names first", () => {
        expect(searchActionCommands(commands, "c", list({ c: "face" }))[0]?.id).toBe("face");
        // Without the abbreviation, `c` is just a prefix and the catalogue order decides.
        expect(searchActionCommands(commands, "c")[0]?.id).not.toBe("face");
    });

    it("matches an abbreviation the query is the start of", () => {
        expect(searchActionCommands(commands, "zz", list({ zzq: "text" })).map(entry => entry.id)).toContain("text");
    });
});
