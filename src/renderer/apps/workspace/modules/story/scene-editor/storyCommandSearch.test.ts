import { describe, expect, it } from "vitest";
import type { PaletteActionCommand } from "./storyActionCommands";
import { specPaletteCommands } from "./commands/specPalette";
import { searchActionCommands } from "./storyCommandSearch";

/**
 * The matcher runs over the spec palette - the one catalogue since A1, shared by the `/` creator and
 * the sidebar. Labels are the raw spec ids here (nothing localizes them), so a hit that depends on the
 * grammar tokens or the pinyin table is proving exactly that.
 */
const COMMANDS = specPaletteCommands();

/** The command ids a query returns, in ranked order. */
function ids(query: string): string[] {
    return searchActionCommands(COMMANDS, query).map(command => command.id);
}

describe("searchActionCommands", () => {
    it("finds a command by its grammar token, which the palette's own fields never carry", () => {
        // `bg` appears in no label / id / detail, yet must resolve to Background - the regression this fixes.
        expect(ids("bg")[0]).toBe("background");
        // A short alias too: `se` is Sound's, `enter` is `/show`'s.
        expect(ids("se")[0]).toBe("sound");
        expect(ids("enter")[0]).toBe("show");
    });

    it("still matches the id an author might type in full", () => {
        expect(ids("transform")[0]).toBe("transform");
    });

    it("finds the renamed declarations by their new tokens, and by the old ones kept as aliases", () => {
        expect(ids("save")[0]).toBe("declareVar");
        expect(ids("global")[0]).toBe("declarePersis");
        expect(ids("var")[0]).toBe("declareVar");
        expect(ids("persis")[0]).toBe("declarePersis");
    });

    it("ranks an exact token above a command that merely has it as a prefix", () => {
        const order = ids("bg");
        expect(order.indexOf("background")).toBeLessThan(order.indexOf("bgm"));
    });

    it("matches fuzzily, so an abbreviation still lands", () => {
        // `bgd` is a subsequence of "background" - no substring would find it.
        expect(ids("bgd")).toContain("background");
    });

    it("matches a translated label without the grammar carrying locale data", () => {
        const background = COMMANDS.find(command => command.id === "background");
        if (!background) {
            throw new Error("background command missing");
        }
        const zh: PaletteActionCommand[] = [{ ...background, label: "背景" }];
        expect(searchActionCommands(zh, "背景").map(command => command.id)).toEqual(["background"]);
    });

    it("lands the slash alias on Note, ranked first, however the query is spelled", () => {
        // The inline creator strips the trigger slash, so Note's `//` arrives as `/`; the sidebar keeps `//`.
        expect(ids("/")[0]).toBe("note");
        expect(ids("//")[0]).toBe("note");
    });

    it("returns everything in palette order for an empty query", () => {
        expect(searchActionCommands(COMMANDS, "").map(command => command.id))
            .toEqual(COMMANDS.map(command => command.id));
    });

    it("matches a zh-labelled command by full pinyin, so a Latin author finds 背景 as `beijing`", () => {
        // Pinyin rides the command id, not its label — English labels here, yet the pinyin still lands.
        expect(ids("beijing")[0]).toBe("background");
        expect(ids("tiaozhuan")[0]).toBe("jump");
    });

    it("matches by pinyin initials (`bj` → 背景), the exact-tier hit ranked first", () => {
        // `bgm` (beijingyinyue → bjyy) only prefix-matches `bj`, so Background's exact initials win.
        expect(ids("bj")[0]).toBe("background");
    });

    it("matches a pinyin substring, so partial input still finds the command", () => {
        // "yinyue" is inside `bgm`'s full pinyin "beijingyinyue".
        expect(ids("yinyue")).toContain("bgm");
    });
});
