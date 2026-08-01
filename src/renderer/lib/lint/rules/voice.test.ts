import { describe, expect, it } from "vitest";
import type { VoiceDocument, VoiceUnit } from "@shared/types/voice";
import { VOICE_DOCUMENT_SCHEMA_VERSION } from "@shared/types/voice";
import { hashSourceText } from "@shared/utils/localizationText";
import type { StoryBlock } from "@shared/types/story";
import { createTestLintContext } from "../testContext";
import type { LintContext } from "../context";
import type { LintFinding, LintRuleId } from "../types";
import { VOICE_LINT_RULES } from "./voice";
import {
    choiceBlock,
    choiceOptionBlock,
    dialogueBlock,
    narrationBlock,
    singleSceneStories,
    textSegment,
} from "./text/testFixtures";

/**
 * The three voice rules. Two behaviours are worth more than the rest:
 *  - the legacy `voiceAssetId` fallback, which the compiler honours and the lint therefore must;
 *  - `voice/missing`'s scope (spoken lines only), which is a product decision, not an oversight.
 */

async function run(id: LintRuleId, ctx: LintContext): Promise<LintFinding[]> {
    const rule = VOICE_LINT_RULES.find(entry => entry.id === id);
    if (!rule) {
        throw new Error(`no such rule: ${id}`);
    }
    return await rule.run(ctx, {});
}

function unit(assetId: string, sourceText: string, status: VoiceUnit["status"] = "linked"): VoiceUnit {
    return { assetId, sourceHash: hashSourceText(sourceText), status };
}

function documentOf(locale: string, units: Record<string, VoiceUnit>): VoiceDocument {
    return { schemaVersion: VOICE_DOCUMENT_SCHEMA_VERSION, locale, units };
}

function contextOf(blocks: StoryBlock[], units: Record<string, VoiceUnit>): LintContext {
    return createTestLintContext({
        stories: singleSceneStories(blocks),
        voice: {
            voicedLocales: ["ja"],
            documents: new Map([["ja", documentOf("ja", units)]]),
        },
    });
}

const LINE = "We should go home.";

describe("voice/missing", () => {
    it("reports an unrecorded spoken line, once per voiced language", async () => {
        const findings = await run(
            "voice/missing",
            contextOf(
                [
                    dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"), { characterId: "char-1" }),
                    narrationBlock("b2", textSegment("t-2", "The rain kept falling.", "narration")),
                ],
                {},
            ),
        );
        expect(findings).toHaveLength(2);
        expect(findings[0].messageKey).toBe("lint.rule.voiceMissing.message");
        expect(findings[0].messageParams).toEqual({ locale: "ja" });
        expect(findings.map(entry => entry.location)).toMatchObject([{ blockId: "b1" }, { blockId: "b2" }]);
    });

    it("stays silent when only the legacy per-row voiceAssetId is set", async () => {
        // The compiler resolves `scene.getVoice(id) || voice`, so this line does play a clip.
        const findings = await run(
            "voice/missing",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"), { voiceAssetId: "asset-9" })], {}),
        );
        expect(findings).toEqual([]);
    });

    it("stays silent when the voice map has a take", async () => {
        const findings = await run(
            "voice/missing",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], { "t-1": unit("asset-1", LINE) }),
        );
        expect(findings).toEqual([]);
    });

    it("does not ask for recordings of choice prompts or options", async () => {
        const findings = await run(
            "voice/missing",
            contextOf(
                [
                    choiceBlock("c1", textSegment("t-c", "Stay or go?", "choicePrompt"), ["o1"]),
                    choiceOptionBlock("o1", textSegment("t-o", "Stay", "choiceText"), "c1"),
                ],
                {},
            ),
        );
        expect(findings).toEqual([]);
    });

    it("ignores a blank line and a disabled row", async () => {
        const findings = await run(
            "voice/missing",
            contextOf(
                [
                    narrationBlock("b1", textSegment("t-1", "   ", "narration")),
                    dialogueBlock("b2", textSegment("t-2", LINE, "dialogue"), { disabled: true }),
                ],
                {},
            ),
        );
        expect(findings).toEqual([]);
    });

    it("is silent when the project has no voice configuration", async () => {
        const ctx = createTestLintContext({
            stories: singleSceneStories([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))]),
        });
        expect(ctx.voice).toBeNull();
        expect(await run("voice/missing", ctx)).toEqual([]);
    });
});

describe("voice/stale", () => {
    it("reports a take recorded against text that has since changed", async () => {
        const findings = await run(
            "voice/stale",
            contextOf([dialogueBlock("b1", textSegment("t-1", "We should go home now.", "dialogue"))], {
                "t-1": unit("asset-1", LINE),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.voiceStale.message");
        expect(findings[0].messageParams).toEqual({ locale: "ja" });
        expect(findings[0].target).toMatchObject({ kind: "storyBlock", blockId: "b1" });
    });

    it("checks a recorded choice line too - the take exists, so it can go out of date", async () => {
        const findings = await run(
            "voice/stale",
            contextOf(
                [
                    choiceBlock("c1", textSegment("t-c", "Stay or go?", "choicePrompt"), ["o1"]),
                    choiceOptionBlock("o1", textSegment("t-o", "Stay here", "choiceText"), "c1"),
                ],
                { "t-o": unit("asset-2", "Stay") },
            ),
        );
        expect(findings.map(entry => entry.location)).toMatchObject([{ blockId: "o1" }]);
    });

    it("leaves a current take and a disabled row alone", async () => {
        const findings = await run(
            "voice/stale",
            contextOf(
                [
                    dialogueBlock("b1", textSegment("t-1", LINE, "dialogue")),
                    dialogueBlock("b2", textSegment("t-2", "Rewritten line", "dialogue"), { disabled: true }),
                ],
                { "t-1": unit("asset-1", LINE, "approved"), "t-2": unit("asset-2", "the old text") },
            ),
        );
        expect(findings).toEqual([]);
    });

    it("is silent when the project has no voice configuration", async () => {
        expect(await run("voice/stale", createTestLintContext())).toEqual([]);
    });
});

describe("voice/orphan", () => {
    it("reports a take whose line is gone", async () => {
        const findings = await run(
            "voice/orphan",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], {
                "t-1": unit("asset-1", LINE),
                "t-deleted": unit("asset-2", "a line that no longer exists"),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.voiceOrphan.message");
        expect(findings[0].messageParams).toEqual({ count: 1, locale: "ja" });
        expect(findings[0].location).toEqual({ kind: "project" });
    });

    it("aggregates a locale's orphans into one counted finding", async () => {
        const findings = await run(
            "voice/orphan",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], {
                "t-1": unit("asset-1", LINE),
                "t-gone-1": unit("asset-2", "one"),
                "t-gone-2": unit("asset-3", "two"),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ count: 2, locale: "ja" });
    });

    it("says nothing at all about a locale with no orphans", async () => {
        const findings = await run(
            "voice/orphan",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], { "t-1": unit("asset-1", LINE) }),
        );
        expect(findings).toEqual([]);
    });

    it("does not call a recorded choice line orphaned while it is still in the script", async () => {
        const findings = await run(
            "voice/orphan",
            contextOf(
                [
                    choiceBlock("c1", textSegment("t-c", "Stay or go?", "choicePrompt"), ["o1"]),
                    choiceOptionBlock("o1", textSegment("t-o", "Stay", "choiceText"), "c1"),
                ],
                { "t-o": unit("asset-2", "Stay") },
            ),
        );
        expect(findings).toEqual([]);
    });

    it("is silent when the project has no voice configuration", async () => {
        expect(await run("voice/orphan", createTestLintContext())).toEqual([]);
    });
});
