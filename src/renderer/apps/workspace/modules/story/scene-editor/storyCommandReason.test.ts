import { describe, expect, it } from "vitest";
import { storyExpr as en } from "@shared/i18n/catalog/en/storyExpr";
import { getCommandLineReason } from "./storyCommandReason";
import type { StoryCommandContext } from "./storyCommandResolution";
import { EMPTY_STORY_COMMAND_CONTEXT } from "./storyCommandResolution";

/**
 * Why a line will not commit.
 *
 * The behaviour this replaces: every failure — a name collision, a typo'd command, an unbalanced
 * paren — showed the same "won't build" badge. An author who typed `/var gold 1` where `gold` was
 * already taken had no way to find that out from the editor, which is exactly how it was reported.
 */
const CONTEXT: StoryCommandContext = {
    ...EMPTY_STORY_COMMAND_CONTEXT,
    images: [{ id: "i1", name: "forest" }, { id: "i2", name: "twin" }, { id: "i3", name: "twin" }],
    characters: [{ id: "c1", name: "Alice" }],
    variables: [
        { name: "gold", ref: { scope: "saved", variableId: "v1" }, valueType: "number" },
        { name: "met", ref: { scope: "scene", variableId: "v2" }, valueType: "boolean" },
    ],
    formsByCharacterId: { c1: ["smile"] },
};

/** The catalog entry a line resolves to, so a test failure names the message rather than a key. */
function reasonFor(source: string): string | null {
    const reason = getCommandLineReason(source, CONTEXT);
    if (!reason) {
        return null;
    }
    const path = reason.key.replace(/^storyExpr\./, "").split(".");
    const text = path.reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
    expect(typeof text, `no catalog entry for ${reason.key}`).toBe("string");
    return text as string;
}

describe("getCommandLineReason", () => {
    it("names a variable already taken, which is what the generic badge could never say", () => {
        expect(reasonFor("/var gold 1")).toBe(en.reason.duplicateVariable);
    });

    it("stays silent on a line that is fine", () => {
        expect(reasonFor("/var fresh 1")).toBe(null);
        expect(reasonFor("/set gold gold + 1")).toBe(null);
        expect(reasonFor("/bg forest")).toBe(null);
        // An unfilled command still commits, so it is not a problem to report.
        expect(reasonFor("/bg")).toBe(null);
    });

    it("stays silent on prose and on a half-typed command token", () => {
        // Reporting "there is no /v command" on the first keystroke after the slash would put a red
        // line under every command the author ever types.
        expect(reasonFor("just narration")).toBe(null);
        expect(reasonFor("/va")).toBe(null);
        expect(reasonFor("/")).toBe(null);
        // ...but once they have moved past the token, the verdict is real.
        expect(reasonFor("/nope ")).toBe(en.reason.unknownCommand);
    });

    it("distinguishes the ways a name can fail", () => {
        expect(reasonFor("/bg nothere")).toBe(en.reason.unknownAsset);
        expect(reasonFor("/bg twin")).toBe(en.reason.ambiguousName);
        expect(reasonFor("/show Zoe")).toBe(en.reason.unknownCharacter);
        expect(reasonFor("/show Alice frown")).toBe(en.reason.unknownForm);
        expect(reasonFor("/set nothere 1")).toBe(en.reason.unknownVariable);
    });

    it("reports the expression's own mistake, not a generic wrapper", () => {
        // An unknown name and an unbalanced paren are different problems with different fixes.
        expect(reasonFor("/set gold nothere + 1")).toBe(en.issue.unknownVariable);
        expect(reasonFor("/set gold (1")).toBe(en.issue.unbalancedParen);
        expect(reasonFor("/set gold nosuchfn(1)")).toBe(en.issue.unknownFunction);
        expect(reasonFor("/set gold abs(1, 2)")).toBe(en.issue.badArity);
    });

    it("reports a value the variable cannot hold, and a condition that is not a test", () => {
        expect(reasonFor("/set gold \"rich\"")).toBe(en.reason.expressionTypeMismatch);
        expect(reasonFor("/if gold")).toBe(en.reason.expressionNotBoolean);
    });

    it("reports a malformed line", () => {
        expect(reasonFor("/bg forest nosuchparam=1")).toBe(en.reason.unknownParam);
        expect(reasonFor("/bg \"unclosed")).toBe(en.reason.unterminatedQuote);
    });
});
