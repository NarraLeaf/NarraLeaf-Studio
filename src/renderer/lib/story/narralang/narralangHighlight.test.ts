import { describe, expect, it } from "vitest";

import { NARRALANG_DEFAULT_DIALECT, type NarralangDialect } from "./narralangDialect";
import { tokenizeNarralangLine, type NarralangScope } from "./narralangHighlight";

/** The line as coloured runs, which is the only shape worth asserting on. */
function paint(line: string, dialect: NarralangDialect = NARRALANG_DEFAULT_DIALECT): [string, NarralangScope][] {
    const tokens = tokenizeNarralangLine(line, dialect);
    return tokens.map((token, index) => {
        const end = tokens[index + 1]?.start ?? line.length;
        return [line.slice(token.start, end), token.scope];
    });
}

/** Every scope the line carries, in order, with the runs themselves dropped. */
function scopes(line: string, dialect?: NarralangDialect): NarralangScope[] {
    return paint(line, dialect).map(([, scope]) => scope);
}

/** What a given fragment of the line was painted as. */
function scopeOf(line: string, fragment: string, dialect?: NarralangDialect): NarralangScope | undefined {
    const at = line.indexOf(fragment);
    const tokens = tokenizeNarralangLine(line, dialect ?? NARRALANG_DEFAULT_DIALECT);
    let found: NarralangScope | undefined;
    for (const token of tokens) {
        if (token.start <= at) {
            found = token.scope;
        }
    }
    return found;
}

describe("tokenizeNarralangLine", () => {
    it("leaves prose alone", () => {
        expect(paint("  夕阳把走廊染成橘色。")).toEqual([["  夕阳把走廊染成橘色。", ""]]);
    });

    it("never emits a run past the end of the line", () => {
        for (const line of ["", "   ", "break", "  camera reset", "  爱丽丝: ", "  menu 问题:"]) {
            for (const token of tokenizeNarralangLine(line, NARRALANG_DEFAULT_DIALECT)) {
                expect(token.start).toBeLessThan(Math.max(line.length, 1));
            }
        }
    });

    it("paints a statement's verb, its prepositions and its values", () => {
        const line = "  show 爱丽丝 smile at left with fade 0.3";
        expect(scopeOf(line, "show")).toBe("keyword");
        expect(scopeOf(line, "at")).toBe("type");
        expect(scopeOf(line, "with")).toBe("type");
        expect(scopeOf(line, "0.3")).toBe("number");
        expect(scopeOf(line, "爱丽丝")).toBe("");
    });

    it("takes the longest verb spelling, so a two-word verb is one keyword", () => {
        const line = "  image create bird bird.png on sky";
        expect(paint(line)[1]).toEqual(["image create", "keyword"]);
        expect(scopeOf(line, "on")).toBe("type");
    });

    it("does not take a verb out of the front of a longer word", () => {
        expect(scopeOf("  settings bird", "settings")).toBe("");
    });

    it("paints the speaker of a dialogue line and leaves what they say as prose", () => {
        const line = "  爱丽丝: 你也留到这么晚啊。";
        expect(paint(line)).toEqual([
            ["  ", ""],
            ["爱丽丝", "attribute.name"],
            [":", "delimiter"],
            [" 你也留到这么晚啊。", ""],
        ]);
    });

    it("paints a per-line dialogue attribute before the separator", () => {
        const line = "  爱丽丝 voice se/alice_01.ogg: 你也留到这么晚啊。";
        expect(scopeOf(line, "爱丽丝")).toBe("attribute.name");
        expect(scopeOf(line, "voice")).toBe("type");
        expect(scopeOf(line, "se/alice_01.ogg")).toBe("");
    });

    it("does not read an escaped separator as a speaker", () => {
        const line = "  他说\\: 好。";
        expect(scopes(line)).toEqual([""]);
    });

    it("does not read a choice option's block opener as a speaker", () => {
        const line = "    「其实我在等你。」:";
        expect(paint(line)).toEqual([
            ["    「其实我在等你。」", ""],
            [":", "delimiter"],
        ]);
    });

    it("greys a note row whole", () => {
        expect(paint("  # 这里以后要补一段回忆闪回")).toEqual([
            ["  ", ""],
            ["# 这里以后要补一段回忆闪回", "comment"],
        ]);
    });

    it("greys only the marker on a switched-off row, so it still reads as what it does", () => {
        const line = "  ~ show bird";
        expect(scopeOf(line, "~")).toBe("comment");
        expect(scopeOf(line, "show")).toBe("keyword");
    });

    it("greys a row nothing could read, marker and all", () => {
        expect(paint("  ~~ /nonsense arg")).toEqual([
            ["  ", ""],
            ["~~ /nonsense arg", "comment"],
        ]);
    });

    it("honours the escape that demotes a line to prose", () => {
        const line = "  \\show me the money";
        expect(paint(line)).toEqual([
            ["  ", ""],
            ["\\", "delimiter"],
            ["show me the money", ""],
        ]);
    });

    it("reads a container's prompt as prose, not as a run of tokens", () => {
        // `at` inside a prompt is a word someone wrote, not a placement.
        const line = "  menu Meet her at the roof?:";
        expect(scopeOf(line, "menu")).toBe("keyword");
        expect(scopeOf(line, "at")).toBe("");
        expect(paint(line).at(-1)).toEqual([":", "delimiter"]);
    });

    it("paints quoted names and string literals as strings", () => {
        expect(scopeOf("  jump '天台 · 夜' with fade 0.6", "'天台")).toBe("string");
        expect(scopeOf("  text create title \"第一章\"", "\"第一章\"")).toBe("string");
    });

    it("keeps a quoted name with spaces in one run", () => {
        const line = "  jump 'Chapter 2' with fade 0.6";
        expect(scopeOf(line, "2'")).toBe("string");
        expect(scopeOf(line, "with")).toBe("type");
    });

    it("paints a rich-text tag and a stage singleton", () => {
        expect(scopeOf("  爱丽丝: 那是{i}她{/i}的名字。", "{i}")).toBe("tag");
        expect(scopeOf("  show @bg", "@bg")).toBe("tag");
    });

    it("leaves an unclosed tag inside its own line", () => {
        const line = "  爱丽丝: 那是{i她";
        expect(paint(line).at(-1)).toEqual(["{i她", "tag"]);
    });

    it("paints the scene header and a block opener", () => {
        const line = "scene '第一章 · 走廊':";
        expect(paint(line)).toEqual([
            ["scene", "keyword"],
            [" ", ""],
            ["'第一章 · 走廊'", "string"],
            [":", "delimiter"],
        ]);
    });

    it("follows the dialect rather than a list of its own", () => {
        // The whole point of the table: rename the verb and move its preposition, and the colours
        // move with them without a second edit anywhere.
        const dialect: NarralangDialect = {
            ...NARRALANG_DEFAULT_DIALECT,
            verbs: {
                ...NARRALANG_DEFAULT_DIALECT.verbs,
                characterRename: {
                    keyword: "alias",
                    slots: [
                        { slot: "subject", value: "name" },
                        { slot: "displayName", lead: "becomes", value: "name" },
                    ],
                },
            },
        };
        expect(scopeOf("  alias 爱丽丝 becomes 神秘的少女", "alias", dialect)).toBe("keyword");
        expect(scopeOf("  alias 爱丽丝 becomes 神秘的少女", "becomes", dialect)).toBe("type");
        // And the word it replaced is no longer one - `rename` is nobody's verb in this dialect.
        expect(scopeOf("  rename 爱丽丝 神秘的少女", "rename", dialect)).toBe("");
    });

    it("follows a dialect that fences rich text differently", () => {
        const dialect: NarralangDialect = {
            ...NARRALANG_DEFAULT_DIALECT,
            text: { ...NARRALANG_DEFAULT_DIALECT.text, open: "[", close: "]" },
        };
        expect(scopeOf("  爱丽丝: 那是[i]她[/i]的名字。", "[i]", dialect)).toBe("tag");
        expect(scopeOf("  爱丽丝: 那是{i}她{/i}的名字。", "{i}", dialect)).toBe("");
    });
});
