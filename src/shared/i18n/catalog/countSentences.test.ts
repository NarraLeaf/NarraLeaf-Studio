import { describe, expect, it } from "vitest";
import { createTranslator, type Translator } from "../translator";

/**
 * Sentences that carry more than one count.
 *
 * A plural group covers one number, so a template holding two or three of them used to spell every
 * noun in the plural whatever the number was: "1 errors, 1 warnings, 1 info". Each count now takes
 * its own plural form and the template only joins the pieces, the way the consumers below build
 * them. English has to read in the singular at one; Chinese and Japanese have no singular, and
 * their sentences are pinned to exactly what they said before the split.
 */

type Build = (translator: Translator, counts: readonly number[]) => string;

const SENTENCES: { name: string; build: Build; en: [number[], string][]; zh: [number[], string]; ja: [number[], string] }[] = [
    {
        name: "lint report header",
        build: ({ t, tn }, [errors, warnings, infos]) => t("lint.report.counts", {
            errors: tn("common.count.errors", errors),
            warnings: tn("common.count.warnings", warnings),
            infos: tn("common.count.infos", infos),
        }),
        en: [
            [[1, 1, 1], "1 error, 1 warning, 1 info"],
            [[2, 0, 3], "2 errors, 0 warnings, 3 info"],
        ],
        zh: [[1, 2, 3], "1 个错误，2 个警告，3 个提示"],
        ja: [[1, 2, 3], "エラー 1 件、警告 2 件、情報 3 件"],
    },
    {
        name: "lint console close",
        build: ({ t, tn }, [errors, warnings]) => t("lint.console.finishedCounts", {
            errors: tn("common.count.errors", errors),
            warnings: tn("common.count.warnings", warnings),
            duration: "0.4s",
        }),
        en: [
            [[1, 1], "1 error, 1 warning in 0.4s"],
            [[0, 12], "0 errors, 12 warnings in 0.4s"],
        ],
        zh: [[1, 2], "1 个错误，2 个警告，用时 0.4s"],
        ja: [[1, 2], "エラー 1 件、警告 2 件（0.4s）"],
    },
    {
        name: "Dev Mode issue tally",
        build: ({ t, tn }, [errors, warnings]) => t("devMode.issues.counts", {
            errors: tn("common.count.errors", errors),
            warnings: tn("common.count.warnings", warnings),
        }),
        en: [
            [[1, 1], "1 error · 1 warning in this run"],
            [[0, 20], "0 errors · 20 warnings in this run"],
        ],
        zh: [[1, 2], "本次运行 1 个错误 · 2 个警告"],
        ja: [[1, 2], "今回の実行でエラー 1 件 · 警告 2 件"],
    },
    {
        name: "test report header",
        build: ({ t, tn }, [errors, warnings, infos]) => t("test.report.findingCounts", {
            errors: tn("common.count.errors", errors),
            warnings: tn("common.count.warnings", warnings),
            infos: tn("common.count.infos", infos),
        }),
        en: [[[1, 1, 0], "1 error, 1 warning, 0 info"]],
        zh: [[1, 2, 3], "1 个错误，2 个警告，3 个提示"],
        ja: [[1, 2, 3], "エラー 1 件、警告 2 件、情報 3 件"],
    },
    {
        name: "build refused by the project check",
        build: ({ tn }, [count]) => tn("lint.build.blocked", count),
        en: [
            [[1], "Build stopped by 1 problem"],
            [[4], "Build stopped by 4 problems"],
        ],
        zh: [[4], "4 个问题中止了构建"],
        ja: [[4], "問題 4 件のためビルドを中止した"],
    },
    {
        name: "partial asset export",
        build: ({ t, tn }, [exported, failed]) => t("assets.export.partialCounts", {
            exported: tn("assets.export.fileCount", exported),
            failed,
        }),
        en: [
            [[1, 2], "Exported 1 file, 2 could not be exported."],
            [[3, 1], "Exported 3 files, 1 could not be exported."],
        ],
        zh: [[3, 1], "已导出 3 个文件，1 个未能导出"],
        ja: [[3, 1], "3 ファイルを書き出し、1 ファイルは書き出せなかった"],
    },
    {
        name: "magic tag summary",
        build: ({ t, tn }, [tags, files]) => t("assets.magicTag.tagCounts", {
            tags: tn("assets.magicTag.tagCount", tags),
            files: tn("assets.magicTag.fileCount", files),
        }),
        en: [
            [[1, 1], "Will add a total of 1 tag to 1 file"],
            [[6, 3], "Will add a total of 6 tags to 3 files"],
        ],
        zh: [[6, 3], "将为 3 个文件共添加 6 个标签"],
        ja: [[6, 3], "3 ファイルに合計 6 個のタグを付ける"],
    },
    {
        name: "translation import",
        build: ({ t, tn }, [applied, unchanged, unknown, skippedEmpty]) => t("workspace.localization.panel.importCounts", {
            applied: tn("workspace.localization.panel.translationCount", applied),
            unchanged,
            unknown,
            skippedEmpty,
        }),
        en: [
            [[1, 0, 0, 0], "Imported 1 translation (0 unchanged, 0 unknown, 0 empty skipped)"],
            [[5, 1, 2, 3], "Imported 5 translations (1 unchanged, 2 unknown, 3 empty skipped)"],
        ],
        zh: [[5, 1, 2, 3], "已导入 5 条翻译（1 条未变更，2 条未知，3 条空译文已跳过）"],
        ja: [[5, 1, 2, 3], "翻訳 5 件を読み込んだ（変更なし 1、対応不明 2、空のため飛ばした 3）"],
    },
    {
        name: "voice take import",
        build: ({ t, tn }, [linked, unmatched, failed]) => t("workspace.voice.panel.importCounts", {
            linked: tn("workspace.voice.panel.takeCount", linked),
            unmatched,
            failed,
        }),
        en: [
            [[1, 0, 0], "Linked 1 take (0 unmatched, 0 failed)"],
            [[4, 1, 2], "Linked 4 takes (1 unmatched, 2 failed)"],
        ],
        zh: [[4, 1, 2], "已关联 4 条（1 条未匹配，2 条失败）"],
        ja: [[4, 1, 2], "テイク 4 件を結びつけた（対応不明 1、失敗 2）"],
    },
    {
        name: "recording script import",
        build: ({ t, tn }, [applied, unchanged, unknown]) => t("workspace.voice.panel.importScriptCounts", {
            applied: tn("workspace.voice.panel.scriptRowCount", applied),
            unchanged,
            unknown,
        }),
        en: [
            [[1, 0, 0], "Applied 1 row (0 unchanged, 0 not voiced)"],
            [[4, 1, 2], "Applied 4 rows (1 unchanged, 2 not voiced)"],
        ],
        zh: [[4, 1, 2], "应用了 4 行（1 行未变，2 行没有语音）"],
        ja: [[4, 1, 2], "4 行を反映した（変更なし 1、ボイス対象外 2）"],
    },
    {
        name: "paste-as-rows totals",
        build: ({ t, tn }, [dialogue, narration, created]) => t("story.paste.totalCounts", {
            dialogue,
            narration,
            created: tn("story.paste.newCharacterCount", created),
        }),
        en: [
            [[3, 2, 1], "3 dialogue · 2 narration · 1 new character"],
            [[3, 2, 0], "3 dialogue · 2 narration · 0 new characters"],
        ],
        zh: [[3, 2, 1], "对白 3 · 旁白 2 · 新建角色 1"],
        ja: [[3, 2, 1], "台詞 3 · 地の文 2 · 新しいキャラクター 1"],
    },
    {
        name: "PSD import cost",
        build: ({ t, tn }, [layers, megabytes]) => t("characters.editor.psd.costCounts", {
            layers: tn("characters.editor.psd.layerCount", layers),
            megabytes,
        }),
        en: [
            [[1, 2], "1 layer · ~2 MB"],
            [[12, 40], "12 layers · ~40 MB"],
        ],
        zh: [[12, 40], "12 层 · 约 40 MB"],
        ja: [[12, 40], "12 レイヤー · 約 40 MB"],
    },
];

describe("sentences with several counts", () => {
    const en = createTranslator("en");
    const zh = createTranslator("zh");
    const ja = createTranslator("ja");

    for (const sentence of SENTENCES) {
        it(`reads each count in its own number in English: ${sentence.name}`, () => {
            for (const [counts, expected] of sentence.en) {
                expect(sentence.build(en, counts)).toBe(expected);
            }
        });

        it(`says in Chinese and Japanese what it said before: ${sentence.name}`, () => {
            expect(sentence.build(zh, sentence.zh[0])).toBe(sentence.zh[1]);
            expect(sentence.build(ja, sentence.ja[0])).toBe(sentence.ja[1]);
        });
    }

    // The two sentences a test hands over as a key and bare numbers, rendered later: no count form
    // can be picked per number there, so they name the noun first and read at any count.
    it("words the stored test summaries so any count reads", () => {
        expect(en.t("test.builtin.projectDiagnostics.summary.failed", { errors: 1, warnings: 1 }))
            .toBe("Problems: errors 1, warnings 1");
        expect(en.t("test.builtin.walkthrough.log.planned", { scenes: 1, decisions: 0 }))
            .toBe("Route planned: scenes 1, decisions 0");
        expect(zh.t("test.builtin.projectDiagnostics.summary.failed", { errors: 1, warnings: 2 }))
            .toBe("1 个错误，2 个警告");
        expect(ja.t("test.builtin.walkthrough.log.planned", { scenes: 1, decisions: 2 }))
            .toBe("経路を決定: シーン 1 件、選択 2 件");
    });
});
