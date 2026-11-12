import type { LocaleNamespace } from "../types";

/** `manuscript` - 台本ドキュメント：Word、Fountain、表の台本を貼り付けウィザードで読み込み、読みやすい台本を PDF か Word で書き出す。 */
export const manuscript = {
    importCommand: "台本ドキュメントを読み込む…",
    importPickerTitle: "台本ドキュメントを読み込む",
    wizardTitle: "{file} を読み込む",
    importAction: "読み込む",
    sceneCount: {
        one: "{count} シーン",
        other: "{count} シーン",
    },
    table: {
        sheet: "シート",
        headerRow: "1 行目は列名",
        role: {
            speaker: "話者",
            text: "セリフ",
            note: "メモ",
            scene: "シーン",
        },
        none: "なし",
        column: "{n} 列目",
        columnNamed: "{n} 列目：{name}",
    },
    error: {
        unreadable: "{file} を読み込めない",
        notOffice: "{file} は Word 文書でも表計算ファイルでもない",
        tooLarge: "{file} は大きすぎるため読み込めない",
        empty: "{file} にセリフがない",
        unsupported: "{file} は対応していない台本形式",
        failed: "読み込みを完了できなかった",
        writeFailed: "{file} に書き込めない",
    },
    imported: {
        one: "{count} シーンを読み込んだ",
        other: "{count} シーンを読み込んだ",
    },
    historyLabel: "台本ドキュメントの読み込み",
    defaultSceneName: "読み込んだシーン",

    exportCommand: "読みやすい台本を書き出す…",
    exportSceneCommand: "シーンを読みやすい台本として書き出す…",
    exportTitle: "読みやすい台本を書き出す",
    format: {
        label: "形式",
        pdf: "PDF",
        docx: "Word 文書",
    },
    scenes: {
        label: "シーン",
        all: "すべてのシーン",
        selectAll: "すべて選択",
        selectNone: "クリア",
    },
    speakers: {
        label: "キャラクター",
        all: "すべてのキャラクター",
        lineCount: {
            one: "{count} 行",
            other: "{count} 行",
        },
    },
    context: {
        label: "各セリフの前の文脈",
        none: "なし",
        lines: {
            one: "{count} 行",
            other: "{count} 行",
        },
    },
    include: {
        label: "含める",
        ids: "行 ID",
        directions: "ト書きとメモ",
        branches: "選択肢",
    },
    exportAction: "書き出す",
    exported: "台本を {path} に書き出した",
    noScenes: "シーンを 1 つ以上選択する",
    noLines: "条件に合うセリフがない",
    linesFor: "{names} のセリフ",
    unnamedSpeaker: "名前なし",
    gap: "一部の行を省略",
    pageOf: "{page} / {total} ページ",
} satisfies LocaleNamespace<"manuscript">;
