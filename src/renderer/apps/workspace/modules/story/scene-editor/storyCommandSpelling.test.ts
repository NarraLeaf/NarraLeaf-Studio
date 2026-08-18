import { afterEach, describe, expect, it } from "vitest";
import { commandI18nStore, i18nStore } from "@/lib/i18n";
import { LOCALIZED_COMMANDS_DEFAULT } from "@/lib/settings/commandLanguageOptions";
import { parseCommandLine } from "./storyCommandParser";
import { localizeCommandVerb } from "./storyCommandSpelling";

/**
 * The line's own verb, spelled in the command language.
 *
 * The seam these close: one command had three spellings on screen at once — the menu showed 显示, the
 * line it produced said `@show`, and the committed row said something else again. A word an author can
 * read in the manual and type by hand has to look the same in all three places.
 */

afterEach(() => {
  commandI18nStore.setPreference(LOCALIZED_COMMANDS_DEFAULT);
  i18nStore.setLocale("en");
});

/** The line after re-spelling, or the line unchanged when nothing was owed. */
function respell(value: string, caret = value.length, alias = true): string {
  return localizeCommandVerb(value, caret, alias)?.value ?? value;
}

describe("localizeCommandVerb", () => {
  it("spells a hand-typed English verb in the command language", () => {
    i18nStore.setLocale("zh");
    expect(respell("@show ")).toBe("@显示 ");
    expect(respell("/show Anyo")).toBe("/显示 Anyo");
    // An alias converges on the same word — three spellings of one command become one.
    expect(respell("@enter Anyo")).toBe("@显示 Anyo");
    expect(respell("/bg forest t=fade")).toBe("/背景 forest t=fade");
  });

  it("leaves the line alone while the verb is still being typed", () => {
    i18nStore.setLocale("zh");
    // `@show` with nothing after it is a word in progress: `@showcase` would never survive being
    // rewritten under the caret at the moment it passed through a command name.
    expect(respell("@show")).toBe("@show");
    expect(respell("@sho")).toBe("@sho");
    expect(respell("@")).toBe("@");
  });

  it("touches nothing where the command language has no word of its own", () => {
    i18nStore.setLocale("en");
    expect(respell("/show Anyo")).toBe("/show Anyo");
    // Aliases are there to be typed: English has one spelling for this command and `enter` is a
    // legitimate way to reach it, so nothing is "corrected" into the canonical token.
    expect(respell("/enter Anyo")).toBe("/enter Anyo");

    // Same when the author keeps an English vocabulary behind a Chinese interface.
    i18nStore.setLocale("zh");
    commandI18nStore.setPreference(false);
    expect(respell("@show Anyo")).toBe("@show Anyo");
  });

  it("is not a rewrite of anything that is not a command line", () => {
    i18nStore.setLocale("zh");
    expect(respell("just narration")).toBe("just narration");
    expect(respell("#Anyo hello")).toBe("#Anyo hello");
    expect(respell("/nosuchcommand x")).toBe("/nosuchcommand x");
    // "@" is only a trigger where the alias is on; otherwise it is an ordinary character.
    expect(respell("@show Anyo", 11, false)).toBe("@show Anyo");
  });

  it("keeps the caret where the author left it", () => {
    i18nStore.setLocale("zh");
    // Typing the space that finishes the verb: the caret rides the length change.
    expect(localizeCommandVerb("@show ", 6, true)).toEqual({ value: "@显示 ", caret: 4 });
    // Editing further along the line, the argument keeps its own offsets.
    expect(localizeCommandVerb("@show Anyo", 10, true)?.caret).toBe(8);
    // A caret inside the word that was replaced lands after it, and one before it does not move.
    expect(localizeCommandVerb("@show Anyo", 3, true)?.caret).toBe(3);
    expect(localizeCommandVerb("@show Anyo", 0, true)?.caret).toBe(0);
  });

  it("only ever produces a line that parses back to the same command", () => {
    // The invariant the feature rests on — a re-spelling that changed what the line means would be
    // worse than the mismatch it set out to fix.
    for (const locale of ["en", "zh"] as const) {
      i18nStore.setLocale(locale);
      for (const source of [
        "/show Anyo",
        "/hide Anyo t=fade",
        "/bg forest",
        "/enter Anyo",
        "/wait 2"
      ]) {
        const before = parseCommandLine(source);
        const after = parseCommandLine(respell(source));
        expect(
          before.kind === "command" && after.kind === "command" && after.def?.commandId,
          `${locale}: ${source}`
        ).toBe(before.kind === "command" ? before.def?.commandId : null);
      }
    }
  });
});
