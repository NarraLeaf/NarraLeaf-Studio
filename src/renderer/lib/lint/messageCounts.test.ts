import { describe, expect, it } from "vitest";
import { createTranslator } from "@shared/i18n";
import { resolveLintMessageParams, type LintFinding } from "./types";

/**
 * Lint messages that state a count. A finding is a key and parameters rendered wherever it is read,
 * so the rule cannot choose "condition" or "conditions" itself; it names a plural group and the
 * number, and the reader's locale spells it. These pin the English at one and at many, and that
 * Chinese and Japanese read exactly as they did before the count was spelled separately.
 */

type Message = Pick<LintFinding, "messageKey" | "messageParams" | "messageParamCounts">;

function render(locale: "en" | "zh" | "ja", finding: Message): string {
    const { t, tn } = createTranslator(locale);
    return t(finding.messageKey, resolveLintMessageParams(finding, t, tn));
}

const readNeverWritten = (count: number): Message => ({
    messageKey: "lint.rule.variablesReadNeverWritten.message",
    messageParams: { variable: "trust", count },
    messageParamCounts: { conditions: { key: "lint.rule.variablesReadNeverWritten.conditionCount", count } },
});

const translationOrphans = (count: number): Message => ({
    messageKey: "lint.rule.localizationOrphan.message",
    messageParams: { count, locale: "ja" },
    messageParamCounts: { translations: { key: "lint.rule.localizationOrphan.translationCount", count } },
});

const recordingOrphans = (count: number): Message => ({
    messageKey: "lint.rule.voiceOrphan.message",
    messageParams: { count, locale: "ja" },
    messageParamCounts: { recordings: { key: "lint.rule.voiceOrphan.recordingCount", count } },
});

const glyph = (count: number): Message => ({
    messageKey: "lint.rule.typographyGlyphCoverage.message",
    messageParams: { character: "龘", count },
    messageParamCounts: { occurrences: { key: "lint.rule.typographyGlyphCoverage.occurrenceCount", count } },
});

const moreGlyphs = (count: number): Message => ({
    messageKey: "lint.rule.typographyGlyphCoverage.messageMoreInLanguage",
    messageParams: { count, language: "日本語" },
    messageParamCounts: { characters: { key: "lint.rule.typographyGlyphCoverage.moreCharacterCount", count } },
});

describe("lint messages that state a count", () => {
    it("read in the singular at one in English", () => {
        expect(render("en", readNeverWritten(1))).toBe("trust is tested by 1 condition but nothing ever sets it");
        expect(render("en", translationOrphans(1))).toBe("1 ja translation with no line");
        expect(render("en", recordingOrphans(1))).toBe("1 ja recording with no line");
        expect(render("en", glyph(1))).toBe("No project font can draw “龘” (1 time)");
        expect(render("en", moreGlyphs(1))).toBe("1 more character no project font can draw in 日本語");
    });

    it("read in the plural otherwise", () => {
        expect(render("en", readNeverWritten(3))).toBe("trust is tested by 3 conditions but nothing ever sets it");
        expect(render("en", translationOrphans(4))).toBe("4 ja translations with no line");
        expect(render("en", recordingOrphans(4))).toBe("4 ja recordings with no line");
        expect(render("en", glyph(2))).toBe("No project font can draw “龘” (2 times)");
        expect(render("en", moreGlyphs(12))).toBe("12 more characters no project font can draw in 日本語");
    });

    it("say in Chinese and Japanese exactly what they said before", () => {
        expect(render("zh", readNeverWritten(3))).toBe("3 处条件判断读取了 trust，但没有任何地方给它赋值");
        expect(render("zh", translationOrphans(4))).toBe("4 条 ja 译文没有对应的行");
        expect(render("zh", recordingOrphans(4))).toBe("4 条 ja 录音没有对应的行");
        expect(render("zh", glyph(2))).toBe("项目字体画不出“龘”（2 处）");
        expect(render("zh", moreGlyphs(12))).toBe("日本語中另有 12 个字符项目字体画不出");
        expect(render("ja", readNeverWritten(3))).toBe("trust を参照する条件が 3 件ありますが、代入する箇所がありません");
        expect(render("ja", translationOrphans(4))).toBe("対応する行のない ja の翻訳が 4 件ある");
        expect(render("ja", recordingOrphans(4))).toBe("対応する行のない ja の録音が 4 件ある");
        expect(render("ja", glyph(2))).toBe("プロジェクトのフォントに「龘」が無い（2 箇所）");
        expect(render("ja", moreGlyphs(12))).toBe("日本語で他に 12 文字、プロジェクトのフォントに無い");
    });

    it("leaves a finding with no counts as it was", () => {
        const plain: Message = { messageKey: "lint.rule.variablesUnused.message", messageParams: { variable: "trust" } };
        const { t, tn } = createTranslator("en");
        expect(resolveLintMessageParams(plain, t, tn)).toBe(plain.messageParams);
    });
});
