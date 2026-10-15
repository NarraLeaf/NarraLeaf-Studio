import { describe, expect, it } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import { createTranslator } from "@shared/i18n/translator";
import { createTestLintContext } from "../testContext";
import type { LintCharacterEntry } from "../context";
import { STORY_LINT_RULES } from "./story";

/**
 * `story/tag-name-shared`: a layered character with one tag name on two axes.
 *
 * A typed row names a look by its tag alone, so a name two axes share only ever reaches the first;
 * the project check is where the author learns which two axes hold it.
 */

const rule = STORY_LINT_RULES.find(candidate => candidate.id === "story/tag-name-shared")!;

async function run(characters: LintCharacterEntry[]) {
    return await rule.run(createTestLintContext({ characters }), {});
}

function mio(axes: LintCharacterEntry["axes"]): LintCharacterEntry {
    return { id: "mio", name: "美绪", assetIds: [], axes };
}

describe("story/tag-name-shared", () => {
    it("names the tag and both axes that hold it, against the character", async () => {
        const findings = await run([mio([
            { name: "表情", tags: ["平静", "笑"] },
            { name: "服装", tags: ["白卫衣", "蓝"] },
            { name: "发型", tags: ["长发", "蓝"] },
        ])]);
        expect(rule.defaultSeverity).toBe("warning");
        expect(findings).toEqual([{
            ruleId: "story/tag-name-shared",
            messageKey: "lint.rule.storyTagNameShared.message",
            messageParams: { tag: "蓝", first: "服装", second: "发型" },
            location: { kind: "character", characterId: "mio", characterName: "美绪" },
            target: { kind: "character", characterId: "mio" },
        }]);
    });

    it("compares names as the editor does, and says each shared name once", async () => {
        const findings = await run([mio([
            { name: "Outfit", tags: ["Blue"] },
            { name: "Hair", tags: [" blue "] },
            { name: "Eyes", tags: ["BLUE"] },
        ])]);
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ messageParams: { tag: "blue", first: "Outfit", second: "Hair" } });
    });

    // The three names are the author's own words, set off from the sentence the way each language
    // quotes a name: bare, "表情 与 服装 两个轴上都有名为 笑 的标签" reads as one run of words.
    it.each([
        ["en", "The tag \"笑\" is on both \"表情\" and \"服装\""],
        ["zh", "「表情」与「服装」两个轴上都有名为「笑」的标签"],
        ["ja", "「表情」と「服装」の両方の軸に「笑」という名前のタグがある"],
    ] as const)("quotes each name in its %s message", async (locale, expected) => {
        const [finding] = await run([mio([
            { name: "表情", tags: ["笑"] },
            { name: "服装", tags: ["笑"] },
        ])]);
        expect(createTranslator(locale).t(finding.messageKey as TranslationKey, finding.messageParams)).toBe(expected);
    });

    it("leaves alone a name repeated on one axis, distinct names, and characters with no axes", async () => {
        expect(await run([
            mio([{ name: "表情", tags: ["笑", "笑"] }, { name: "服装", tags: ["白卫衣"] }]),
            { id: "narra", name: "Narra", assetIds: [] },
        ])).toEqual([]);
    });
});
