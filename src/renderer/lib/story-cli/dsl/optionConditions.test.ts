import { describe, expect, it } from "vitest";
import { readInlineMarkup } from "./inlineMarkup";
import { escapeOptionWords, spellOptionClauses, splitOptionLine } from "./optionConditions";

function parts(text: string) {
    const split = splitOptionLine(text);
    expect(split.ok, text).toBe(true);
    return split.ok ? split.parts : null!;
}

function valueOf(escapedWords: string): string {
    const read = readInlineMarkup(escapedWords);
    expect(read.ok, escapedWords).toBe(true);
    return read.ok ? read.value : "";
}

function failure(text: string): string {
    const split = splitOptionLine(text);
    expect(split.ok, text).toBe(false);
    return split.ok ? "" : split.message;
}

describe("the clauses at the end of an option line", () => {
    it("reads each clause as the source of its condition", () => {
        expect(parts("Library [hide if visited(Library)]")).toEqual({
            words: "Library",
            conditions: { hide: "visited(Library)" },
        });
        expect(parts("Buy it [disable if gold < 10] [hide if sold]")).toEqual({
            words: "Buy it",
            conditions: { disable: "gold < 10", hide: "sold" },
        });
    });

    it("lets the expression hold brackets and strings with brackets in them", () => {
        expect(parts("Pick [hide if [\"a\", \"b]\"][0] == route]").conditions).toEqual({
            hide: "[\"a\", \"b]\"][0] == route",
        });
        expect(parts("Pick [hide if inv[0] == \"say \\\\\\\"]\\\\\\\"\"]").conditions.hide).toBe("inv[0] == \"say \\\"]\\\"\"");
    });

    it("leaves a bracket the words go on after as words", () => {
        expect(parts("Go [now if you like] and wait")).toEqual({
            words: "Go [now if you like] and wait",
            conditions: {},
        });
        expect(parts("No clause here [at all]").conditions).toEqual({});
    });

    it("refuses a clause it does not know, an unclosed one, a repeated one and an empty one", () => {
        expect(failure("Go [show if met]")).toContain("is not an option clause");
        expect(failure("Go [hide if met")).toContain("never closed");
        expect(failure("Go [hide if a] [hide if b]")).toContain("two [hide if …] clauses");
        expect(failure("Go [hide if ]")).toContain("needs an expression");
    });

    it("prints hide before disable, and reads back what it printed", () => {
        const printed = `Go${spellOptionClauses({ disable: "gold < 10", hide: "visited(Shop)" })}`;
        expect(printed).toBe("Go [hide if visited(Shop)] [disable if gold < 10]");
        expect(parts(printed).conditions).toEqual({ hide: "visited(Shop)", disable: "gold < 10" });
    });

    it("escapes words that would read as a clause, so they come back as the same words", () => {
        for (const words of ["Say [hide if x]", "A [disable if b] c", "Keep \\[this]", "Odd [Hide if x]"]) {
            const escaped = escapeOptionWords(words);
            const back = parts(`${escaped}${spellOptionClauses({ hide: "met" })}`);
            expect(back.conditions, words).toEqual({ hide: "met" });
            expect(back.words, words).toBe(escaped);
            // The escape changes the spelling, never what the player reads.
            expect(valueOf(back.words), words).toBe(valueOf(words));
        }
    });
});
