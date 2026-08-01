import { describe, expect, it } from "vitest";
import type { LocalizationDocument, LocalizationUnit } from "@shared/types/localization";
import { LOCALIZATION_DOCUMENT_SCHEMA_VERSION } from "@shared/types/localization";
import { hashSourceText } from "@shared/utils/localizationText";
import type { StoryBlock } from "@shared/types/story";
import { createTestLintContext } from "../testContext";
import type { LintContext } from "../context";
import type { LintFinding, LintRuleId } from "../types";
import { LOCALIZATION_LINT_RULES } from "./localization";
import {
    choiceBlock,
    choiceOptionBlock,
    dialogueBlock,
    narrationBlock,
    singleSceneStories,
    textSegment,
} from "./text/testFixtures";

/**
 * The three localization rules, and the one thing they must never do: speak when the project has no
 * localization configured (ruling R5 - silent, not off).
 */

async function run(id: LintRuleId, ctx: LintContext): Promise<LintFinding[]> {
    const rule = LOCALIZATION_LINT_RULES.find(entry => entry.id === id);
    if (!rule) {
        throw new Error(`no such rule: ${id}`);
    }
    return await rule.run(ctx, {});
}

function unit(target: string, sourceText: string, status: LocalizationUnit["status"] = "translated"): LocalizationUnit {
    return { target, sourceHash: hashSourceText(sourceText), status };
}

function documentOf(locale: string, units: Record<string, LocalizationUnit>): LocalizationDocument {
    return { schemaVersion: LOCALIZATION_DOCUMENT_SCHEMA_VERSION, locale, units };
}

function contextOf(blocks: StoryBlock[], units: Record<string, LocalizationUnit>): LintContext {
    return createTestLintContext({
        stories: singleSceneStories(blocks),
        localization: {
            sourceLocale: "en",
            // "en" is listed deliberately: the source locale must be filtered out, not translated.
            targetLocales: ["ja", "en"],
            documents: new Map([["ja", documentOf("ja", units)]]),
        },
    });
}

const LINE = "We should go home.";

describe("localization/missing", () => {
    it("reports an absent unit and an empty one, once per target locale", async () => {
        const findings = await run(
            "localization/missing",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], {}),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.localizationMissing.message");
        expect(findings[0].messageParams).toEqual({ locale: "ja" });
        expect(findings[0].location).toMatchObject({ kind: "story", blockId: "b1" });

        const empty = await run(
            "localization/missing",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], { "t-1": unit("", LINE) }),
        );
        expect(empty.map(entry => entry.messageKey)).toEqual(["lint.rule.localizationMissing.message"]);
    });

    /**
     * `deriveUnitState` is the authority (see the rule's doc comment): both of these units render as
     * *translated* in the localization editor, so lint does not get to call them missing. The stale
     * flag left on an imported row is outranked by the target being there; a whitespace-only target
     * is a target as far as that function is concerned.
     */
    it("defers to deriveUnitState on a unit whose status is still untranslated", async () => {
        const findings = await run(
            "localization/missing",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], {
                "t-1": unit("家に帰ろう。", LINE, "untranslated"),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("defers to deriveUnitState on a whitespace-only target", async () => {
        const findings = await run(
            "localization/missing",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], { "t-1": unit("  ", LINE) }),
        );
        expect(findings).toEqual([]);
    });

    it("leaves a stale unit to localization/stale", async () => {
        const findings = await run(
            "localization/missing",
            contextOf([dialogueBlock("b1", textSegment("t-1", "We should go home now.", "dialogue"))], {
                "t-1": unit("家に帰ろう。", LINE),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("says nothing about a translated line, a blank line or a disabled row", async () => {
        const findings = await run(
            "localization/missing",
            contextOf(
                [
                    dialogueBlock("b1", textSegment("t-1", LINE, "dialogue")),
                    narrationBlock("b2", textSegment("t-2", "   ", "narration")),
                    dialogueBlock("b3", textSegment("t-3", "Untranslated but disabled", "dialogue"), {
                        disabled: true,
                    }),
                ],
                { "t-1": unit("家に帰ろう。", LINE) },
            ),
        );
        expect(findings).toEqual([]);
    });

    it("covers choice prompts and options as well as spoken lines", async () => {
        const findings = await run(
            "localization/missing",
            contextOf(
                [
                    choiceBlock("c1", textSegment("t-c", "Stay or go?", "choicePrompt"), ["o1"]),
                    choiceOptionBlock("o1", textSegment("t-o", "Stay", "choiceText"), "c1"),
                ],
                {},
            ),
        );
        expect(findings.map(entry => entry.location)).toMatchObject([{ blockId: "c1" }, { blockId: "o1" }]);
    });

    it("is silent when the project has no localization", async () => {
        const ctx = createTestLintContext({
            stories: singleSceneStories([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))]),
        });
        expect(ctx.localization).toBeNull();
        expect(await run("localization/missing", ctx)).toEqual([]);
    });
});

describe("localization/stale", () => {
    it("reports a translation hashed against text that has since changed", async () => {
        const findings = await run(
            "localization/stale",
            contextOf([dialogueBlock("b1", textSegment("t-1", "We should go home now.", "dialogue"))], {
                "t-1": unit("家に帰ろう。", LINE),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.localizationStale.message");
        expect(findings[0].messageParams).toEqual({ locale: "ja" });
    });

    it("leaves a current translation, an empty unit and a disabled row alone", async () => {
        const findings = await run(
            "localization/stale",
            contextOf(
                [
                    dialogueBlock("b1", textSegment("t-1", LINE, "dialogue")),
                    // Empty target: `localization/missing`'s finding, not a second one here.
                    dialogueBlock("b2", textSegment("t-2", "Rewritten line", "dialogue")),
                    dialogueBlock("b3", textSegment("t-3", "Rewritten line", "dialogue"), { disabled: true }),
                ],
                {
                    "t-1": unit("家に帰ろう。", LINE),
                    "t-2": unit("", "the old text"),
                    "t-3": unit("古い訳", "the old text"),
                },
            ),
        );
        expect(findings).toEqual([]);
    });

    it("is silent when the project has no localization", async () => {
        expect(await run("localization/stale", createTestLintContext())).toEqual([]);
    });
});

describe("localization/orphan", () => {
    it("reports a unit whose line is gone and ignores the non-story namespaces", async () => {
        const findings = await run(
            "localization/orphan",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], {
                "t-1": unit("家に帰ろう。", LINE),
                "t-deleted": unit("消えた行", "a line that no longer exists"),
                "key:menu.start": unit("はじめる", "Start"),
                "char:char-1": unit("あおい", "Aoi"),
                "ui:element-1.text": unit("設定", "Settings"),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.localizationOrphan.message");
        expect(findings[0].messageParams).toEqual({ count: 1, locale: "ja" });
        expect(findings[0].location).toEqual({ kind: "project" });
    });

    it("aggregates a locale's orphans into one counted finding", async () => {
        const findings = await run(
            "localization/orphan",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], {
                "t-1": unit("家に帰ろう。", LINE),
                "t-gone-1": unit("消えた行", "one"),
                "t-gone-2": unit("消えた行", "two"),
                "t-gone-3": unit("消えた行", "three"),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ count: 3, locale: "ja" });
    });

    it("says nothing at all about a locale with no orphans", async () => {
        const findings = await run(
            "localization/orphan",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"))], {
                "t-1": unit("家に帰ろう。", LINE),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("treats a disabled row's unit as orphaned - the row is not in the game", async () => {
        const findings = await run(
            "localization/orphan",
            contextOf([dialogueBlock("b1", textSegment("t-1", LINE, "dialogue"), { disabled: true })], {
                "t-1": unit("家に帰ろう。", LINE),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ count: 1, locale: "ja" });
    });

    it("is silent when the project has no localization", async () => {
        expect(await run("localization/orphan", createTestLintContext())).toEqual([]);
    });
});
