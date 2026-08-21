import type { LocaleNamespace } from "../types";

/**
 * `dictionary` 日本語。プロジェクト自身の用語集。辞書パネルで編集する。
 *
 * 見出しは名詞句。読みは `story.ruby.placeholder` と同じ「読み」、別の書き方は「別表記」。
 */
export const dictionary = {
    search: "用語を検索",
    add: "用語の追加",
    newTerm: "新しい用語",
    empty: "用語なし",
    noMatches: "一致する用語なし",
    remove: "用語の削除",
    addSelection: "「{term}」を辞書に追加",
    field: {
        term: "用語",
        reading: "読み",
        variants: "別表記",
        note: "備考",
    },
    options: {
        suggestReadings: "読みの提案",
        checkVariants: "別表記の検査",
    },
} satisfies LocaleNamespace<"dictionary">;
