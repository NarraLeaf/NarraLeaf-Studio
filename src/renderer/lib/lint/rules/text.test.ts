import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import { createTestLintContext } from "../testContext";
import { resolveRuleOptions } from "../engine";
import type { LintContext } from "../context";
import type { LintFinding, LintRuleId } from "../types";
import { TEXT_LINT_RULES } from "./text";
import { measureSegmentWidth, measureTextWidth } from "./text/displayWidth";
import {
    choiceBlock,
    choiceOptionBlock,
    dialogueBlock,
    narrationBlock,
    singleSceneStories,
    textSegment,
} from "./text/testFixtures";

/**
 * The width counter is tested directly as well as through the rule: it is the only piece of W4 with
 * arithmetic in it, and "121 fires, 120 does not" is exactly the boundary an author will notice.
 */

async function run(id: LintRuleId, ctx: LintContext, stored?: Record<string, string | number>): Promise<LintFinding[]> {
    const rule = TEXT_LINT_RULES.find(entry => entry.id === id);
    if (!rule) {
        throw new Error(`no such rule: ${id}`);
    }
    // Through the engine's own merge, so a test never sees options the running rule would not.
    return await rule.run(ctx, resolveRuleOptions(rule, stored));
}

function contextOf(blocks: StoryBlock[]): LintContext {
    return createTestLintContext({ stories: singleSceneStories(blocks) });
}

const INTERPOLATION = {
    interpolation: { kind: "variable" as const, target: { scope: "scene" as const, variableId: "var-1" } },
};

describe("east-asian width counter", () => {
    it("charges wide characters two columns and code points one", () => {
        expect(measureTextWidth("你好", "eastAsianWidth")).toBe(4);
        expect(measureTextWidth("你好", "codePoints")).toBe(2);
    });

    it("counts an astral character once, not once per surrogate", () => {
        // Emoji: not an East-Asian width block, so one column - but one, never two for its pair.
        expect("😀".length).toBe(2);
        expect(measureTextWidth("😀", "eastAsianWidth")).toBe(1);
        expect(measureTextWidth("😀", "codePoints")).toBe(1);
        // CJK Extension B (U+20000) is astral AND wide: two columns, from one code point.
        expect(measureTextWidth("\u{20000}", "eastAsianWidth")).toBe(2);
        expect(measureTextWidth("\u{20000}", "codePoints")).toBe(1);
    });

    it("measures literal runs only, never interpolation placeholders", () => {
        const segment = textSegment("t-1", "ignored plain projection", "dialogue", [
            { text: "abcde" },
            INTERPOLATION,
            { pause: true },
        ]);
        expect(measureSegmentWidth(segment, "eastAsianWidth")).toBe(5);
    });
});

describe("text/overlong", () => {
    it("fires one column over the maximum and not at it", async () => {
        const atLimit = await run(
            "text/overlong",
            contextOf([dialogueBlock("b1", textSegment("t-1", "a".repeat(120), "dialogue"))]),
        );
        expect(atLimit).toEqual([]);

        const over = await run(
            "text/overlong",
            contextOf([dialogueBlock("b1", textSegment("t-1", "a".repeat(121), "dialogue"))]),
        );
        expect(over).toHaveLength(1);
        expect(over[0].messageKey).toBe("lint.rule.textOverlong.message");
        expect(over[0].messageParams).toEqual({ width: 121, max: 120 });
        expect(over[0].location).toMatchObject({ kind: "story", sceneName: "Scene One", blockId: "b1" });
        expect(over[0].target).toMatchObject({ kind: "storyBlock", blockId: "b1" });
    });

    it("counts a Chinese line double under the default mode and single under codePoints", async () => {
        const ctx = contextOf([dialogueBlock("b1", textSegment("t-1", "你".repeat(70), "dialogue"))]);

        const wide = await run("text/overlong", ctx);
        expect(wide).toHaveLength(1);
        expect(wide[0].messageParams).toEqual({ width: 140, max: 120 });

        const plain = await run("text/overlong", ctx, { countMode: "codePoints" });
        expect(plain).toEqual([]);
    });

    it("honours a non-default maxChars", async () => {
        const ctx = contextOf([narrationBlock("b1", textSegment("t-1", "a".repeat(60), "narration"))]);
        expect(await run("text/overlong", ctx)).toEqual([]);
        const strict = await run("text/overlong", ctx, { maxChars: 40 });
        expect(strict).toHaveLength(1);
        expect(strict[0].messageParams).toEqual({ width: 60, max: 40 });
    });

    it("does not charge for an interpolation's unknowable width", async () => {
        const segment = textSegment("t-1", "aaaaaaaaaa{gold}", "dialogue", [{ text: "a".repeat(10) }, INTERPOLATION]);
        // Serialized for translators this is "aaaaaaaaaa{0}" - 13 columns, which would fire at 10.
        expect(await run("text/overlong", contextOf([dialogueBlock("b1", segment)]), { maxChars: 10 })).toEqual([]);
    });

    it("ignores a disabled row", async () => {
        const ctx = contextOf([
            dialogueBlock("b1", textSegment("t-1", "a".repeat(400), "dialogue"), { disabled: true }),
        ]);
        expect(await run("text/overlong", ctx)).toEqual([]);
    });

    it("ignores a live option inside a disabled choice", async () => {
        const ctx = contextOf([
            choiceBlock("c1", textSegment("t-c", "Pick", "choicePrompt"), ["o1"], { disabled: true }),
            choiceOptionBlock("o1", textSegment("t-o", "a".repeat(400), "choiceText"), "c1"),
        ]);
        expect(await run("text/overlong", ctx)).toEqual([]);
    });
});

describe("text/empty", () => {
    it("reports a blank dialogue and a whitespace-only narration", async () => {
        const findings = await run(
            "text/empty",
            contextOf([
                dialogueBlock("b1", textSegment("t-1", "", "dialogue")),
                narrationBlock("b2", textSegment("t-2", "   \n ", "narration")),
            ]),
        );
        expect(findings).toHaveLength(2);
        expect(findings[0].messageKey).toBe("lint.rule.textEmpty.message");
        expect(findings.map(entry => entry.location)).toMatchObject([{ blockId: "b1" }, { blockId: "b2" }]);
    });

    it("reports a blank choice option", async () => {
        const findings = await run(
            "text/empty",
            contextOf([
                choiceBlock("c1", textSegment("t-c", "Pick one", "choicePrompt"), ["o1"]),
                choiceOptionBlock("o1", textSegment("t-o", "", "choiceText"), "c1"),
            ]),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].location).toMatchObject({ blockId: "o1" });
    });

    it("leaves a written line, a blank prompt, an interpolation-only line and an event-only line alone", async () => {
        const findings = await run(
            "text/empty",
            contextOf([
                dialogueBlock("b1", textSegment("t-1", "We should go home.", "dialogue")),
                // A choice with no prompt text is an author saying "no prompt", not an empty line.
                choiceBlock("c1", textSegment("t-c", "", "choicePrompt"), ["o1"]),
                choiceOptionBlock("o1", textSegment("t-o", "Stay", "choiceText"), "c1"),
                dialogueBlock("b2", textSegment("t-2", "", "dialogue", [INTERPOLATION])),
                dialogueBlock("b3", textSegment("t-3", "", "dialogue", [{ event: { sound: { assetId: "a-1" } } }])),
            ]),
        );
        expect(findings).toEqual([]);
    });

    it("ignores a disabled row", async () => {
        const ctx = contextOf([dialogueBlock("b1", textSegment("t-1", "", "dialogue"), { disabled: true })]);
        expect(await run("text/empty", ctx)).toEqual([]);
    });
});
