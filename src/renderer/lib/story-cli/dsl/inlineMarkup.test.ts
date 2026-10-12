/**
 * Inline styling in `.story` lines: bold, italic and colour runs spelled as tags, read back as the
 * same runs, with every other kind of styling left to the opaque `»` row.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryRichRun, StoryTextSegment } from "@shared/types/story";
import { sameRowContent } from "./equal";
import { NARRALANG_DEFAULT_DIALECT } from "@/lib/story/narralang/narralangDialect";
import { printNarralangText } from "@/lib/story/narralang/narralangText";
import { readInlineMarkup, spellRichSegment } from "./inlineMarkup";
import { buildProseBlock, proseLineOf, type ProseLookups } from "./prose";

const lookups: ProseLookups = {
    characterName: id => (id === "mei" ? "Mei" : null),
    charactersNamed: name => (name === "Mei" ? [{ id: "mei", name: "Mei" }] : []),
};

function seg(value: string, rich?: StoryRichRun[]): StoryTextSegment {
    return { textId: "t1", role: "dialogue", value, ...(rich ? { rich } : {}) };
}

function dialogue(text: StoryTextSegment): StoryBlock {
    return { id: "row", parentId: null, childrenIds: [], kind: "nodeAction", payload: { action: "dialogue", characterId: "mei", text } } as StoryBlock;
}

function roundTrip(block: StoryBlock) {
    const line = proseLineOf(block, lookups);
    if (!line) {
        return { line: null, same: false };
    }
    const built = buildProseBlock(line, { previous: block, mintId: () => "minted", lookups });
    return { line: line.text, same: built.ok && sameRowContent(built.block, block) };
}

describe("reading inline tags", () => {
    it("turns tags into runs and keeps the plain value in step", () => {
        expect(readInlineMarkup("It was {color #ff0000}red{/color} and {b}{i}loud{/i}{/b}.")).toEqual({
            ok: true,
            value: "It was red and loud.",
            rich: [
                { text: "It was " },
                { text: "red", marks: { color: "#ff0000" } },
                { text: " and " },
                { text: "loud", marks: { bold: true, italic: true } },
                { text: "." },
            ],
        });
    });

    it("nests, and closes the innermost tag of its own kind", () => {
        expect(readInlineMarkup("{color #00f}blue {b}bold{/b} blue{/color}")).toMatchObject({
            rich: [
                { text: "blue ", marks: { color: "#00f" } },
                { text: "bold", marks: { color: "#00f", bold: true } },
                { text: " blue", marks: { color: "#00f" } },
            ],
        });
    });

    it("keeps escaped and non-tag braces as text, with no runs", () => {
        expect(readInlineMarkup("\\{b} is a tag, {gold} is not, \\: fine")).toEqual({ ok: true, value: "{b} is a tag, {gold} is not, : fine" });
        // A colour tag needs its colour: these are text, as they always were.
        expect(readInlineMarkup("{color} and {color }")).toEqual({ ok: true, value: "{color} and {color }" });
    });

    it("reads a colour quoted the Script View's way, with its escapes", () => {
        expect(readInlineMarkup('{color "rgb(56, 189, 248)"}sky{/color}')).toMatchObject({
            ok: true,
            rich: [{ text: "sky", marks: { color: "rgb(56, 189, 248)" } }],
        });
        expect(readInlineMarkup('{color "a\\"b"}x{/color}')).toMatchObject({ rich: [{ text: "x", marks: { color: 'a"b' } }] });
    });

    it("still reads the {color=…} spelling agents and Ren'Py write", () => {
        expect(readInlineMarkup("It was {color=#ff0000}red{/color}.")).toEqual({
            ok: true,
            value: "It was red.",
            rich: [{ text: "It was " }, { text: "red", marks: { color: "#ff0000" } }, { text: "." }],
        });
        expect(readInlineMarkup("{color= rgb(1, 2, 3) }x{/color}")).toMatchObject({ rich: [{ text: "x", marks: { color: "rgb(1, 2, 3)" } }] });
    });

    it("refuses tags that are not closed, close nothing, or name no colour", () => {
        expect(readInlineMarkup("{b}never closed")).toMatchObject({ ok: false, detail: "{b} is never closed" });
        expect(readInlineMarkup("stray{/i}")).toMatchObject({ ok: false, detail: expect.stringMatching(/closes a \{i\} that is not open/) });
        expect(readInlineMarkup("stray{/color}")).toMatchObject({ ok: false, detail: '"{/color}" closes a {color …} that is not open' });
        expect(readInlineMarkup("{color=red}x")).toMatchObject({ ok: false, detail: "{color red} is never closed" });
        expect(readInlineMarkup('{color "rgb(1, 2, 3)"}x')).toMatchObject({ ok: false, detail: '{color "rgb(1, 2, 3)"} is never closed' });
        // Read as a run whose colour was "" before; refused by name now.
        expect(readInlineMarkup("{color= }x{/color}")).toMatchObject({ ok: false, detail: expect.stringMatching(/^"\{color= \}" names no colour/) });
        expect(readInlineMarkup('{color ""}x{/color}')).toMatchObject({ ok: false, detail: expect.stringMatching(/names no colour/) });
    });
});

describe("spelling styled runs", () => {
    it("writes the fewest tags that read back as the same runs", () => {
        expect(spellRichSegment(seg("red bold red", [
            { text: "red ", marks: { color: "#f00" } },
            { text: "bold", marks: { color: "#f00", bold: true } },
            { text: " red", marks: { color: "#f00" } },
        ]))).toBe("{color #f00}red {b}bold{/b} red{/color}");
    });

    it("spells a colour the way the Script View does, quoting one that holds a space", () => {
        for (const color of ["#e04040", "rgb(56, 189, 248)", 'a"b']) {
            const runs = [{ text: "x", marks: { color } }];
            const story = spellRichSegment(seg("x", runs));
            expect(story).toBe(printNarralangText({ context: "narration", runs }, NARRALANG_DEFAULT_DIALECT));
            expect(readInlineMarkup(story!)).toMatchObject({ ok: true, rich: runs });
        }
        expect(spellRichSegment(seg("x", [{ text: "x", marks: { color: "rgb(56, 189, 248)" } }]))).toBe('{color "rgb(56, 189, 248)"}x{/color}');
    });

    it("declines styling it has no tag for", () => {
        expect(spellRichSegment(seg("x", [{ text: "x", marks: { ruby: "えっくす" } }]))).toBeNull();
        expect(spellRichSegment(seg("a b", [{ text: "a" }, { pause: 500 }, { text: " b" }]))).toBeNull();
        expect(spellRichSegment(seg("x", [{ interpolation: { variable: { scope: "saved", id: "gold" } } as never }]))).toBeNull();
    });
});

describe("a styled line round-trips", () => {
    it("bold, italic and colour on a dialogue row", () => {
        const block = dialogue(seg("It was red and loud.", [
            { text: "It was " },
            { text: "red", marks: { color: "#ff0000" } },
            { text: " and " },
            { text: "loud", marks: { bold: true, italic: true } },
            { text: "." },
        ]));
        expect(roundTrip(block)).toEqual({ line: "Mei: It was {color #ff0000}red{/color} and {b}{i}loud{/i}{/b}.", same: true });
    });

    it("a colour with a space in it, quoted, comes back exactly", () => {
        const block = dialogue(seg("a sky b", [
            { text: "a " },
            { text: "sky", marks: { color: "rgb(56, 189, 248)", bold: true } },
            { text: " b" },
        ]));
        expect(roundTrip(block)).toEqual({ line: 'Mei: a {color "rgb(56, 189, 248)"}{b}sky{/b}{/color} b', same: true });
    });

    it("escapes what would otherwise read as markup or as another line shape", () => {
        expect(roundTrip(dialogue(seg("Type {b} to bold: easy")))).toEqual({ line: "Mei: Type \\{b} to bold\\: easy", same: true });
        // Both colour spellings are tags when read, so a literal one of either is escaped.
        expect(roundTrip(dialogue(seg("Write {color red} or {color=red}")))).toEqual({ line: "Mei: Write \\{color red} or \\{color=red}", same: true });
        expect(roundTrip(dialogue(seg("- a dash", [{ text: "- a dash", marks: { italic: true } }])))).toEqual({ line: "Mei: {i}- a dash{/i}", same: true });
        expect(roundTrip(dialogue(seg(" lead", [{ text: " lead", marks: { bold: true } }]))).same).toBe(true);
    });

    it("leaves a row whose runs it would merge to the opaque line", () => {
        const split = dialogue(seg("ab", [{ text: "a", marks: { bold: true } }, { text: "b", marks: { bold: true } }]));
        expect(roundTrip(split).same).toBe(false);
        const ruby = dialogue(seg("x", [{ text: "x", marks: { ruby: "y" } }]));
        expect(roundTrip(ruby).line).toBeNull();
    });

    it("a plain line typed with tags gains runs", () => {
        const built = buildProseBlock({ shape: "narration", text: "The {color #40a8c4}sea{/color} was calm." }, { previous: null, mintId: () => "t9", lookups });
        expect(built.ok && built.block.kind === "nodeAction" && built.block.payload).toMatchObject({
            action: "narration",
            text: { value: "The sea was calm.", rich: [{ text: "The " }, { text: "sea", marks: { color: "#40a8c4" } }, { text: " was calm." }] },
        });
        const broken = buildProseBlock({ shape: "narration", text: "{b}oops" }, { previous: null, mintId: () => "t9", lookups });
        expect(broken).toMatchObject({ ok: false, reason: "inlineMarkup" });
    });
});
