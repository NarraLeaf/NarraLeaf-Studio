import { describe, expect, it } from "vitest";
import { ACTION_COMMANDS, type PaletteActionCommand } from "./storyActionCommands";
import { searchActionCommands } from "./storyCommandSearch";

/** The command ids a query returns, in ranked order. Palette labels are English here. */
function ids(query: string): string[] {
    return searchActionCommands(ACTION_COMMANDS, query).map(command => command.id);
}

describe("searchActionCommands", () => {
    it("finds a command by its grammar token, which the palette's own fields never carry", () => {
        // `bg` appears in no label / id / detail, yet must resolve to Background — the regression this fixes.
        expect(ids("bg")[0]).toBe("background");
        expect(ids("show")[0]).toBe("characterEnter");
        // A short alias too: `se` is Sound's.
        expect(ids("se")[0]).toBe("sound");
    });

    it("still matches the id an author might type in full", () => {
        expect(ids("characterEnter")[0]).toBe("characterEnter");
    });

    it("ranks an exact token above a command that merely has it as a prefix", () => {
        const order = ids("bg");
        expect(order.indexOf("background")).toBeLessThan(order.indexOf("bgm"));
    });

    it("matches fuzzily, so an abbreviation still lands", () => {
        // `bgd` is a subsequence of "background" — no substring would find it.
        expect(ids("bgd")).toContain("background");
    });

    it("matches a translated label without the grammar carrying locale data", () => {
        const background = ACTION_COMMANDS.find(command => command.id === "background");
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
        expect(searchActionCommands(ACTION_COMMANDS, "").map(command => command.id))
            .toEqual(ACTION_COMMANDS.map(command => command.id));
    });
});
