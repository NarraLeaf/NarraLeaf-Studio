import type { LocaleNamespace } from "../types";

/**
 * `brand` 日本語。プロジェクト自身の配色。
 *
 * 名前はその色が何を塗るかを言う。id の綴りをなぞらない。
 */
export const brand = {
    presetName: {
        primary: "メインカラー",
        secondary: "サブカラー",
        background: "背景",
        foreground: "前景",

        "button-primary": "ボタンの塗り",
        "button-secondary": "ボタンのホバー時の塗り",
        "button-border": "ボタンの枠線",
        "button-text": "ボタンの文字",
        "button-shadow": "ボタンの影",

        "container-background": "コンテナの背景",
        "container-border": "コンテナの枠線",
        "container-shadow": "コンテナの影",

        "text-primary": "文字",
        "text-muted": "補助の文字",

        "textInput-background": "テキスト入力の背景",
        "textInput-border": "テキスト入力の枠線",
        "textInput-text": "テキスト入力の文字",
    },

    picker: {
        section: "プロジェクトの色",
    },

    group: {
        button: "ボタン",
        container: "コンテナ",
        text: "文字",
        textInput: "テキスト入力",
    },

    fonts: {
        description: "文字は、その字を持つ最初のフォントで表示する",
        add: "フォントを追加",
        remove: "{name}を削除",
        moveUp: "{name}を上へ",
        moveDown: "{name}を下へ",
        missing: "フォントが見つからない",
        locales: {
            edit: "{name}の言語",
            title: "言語",
            all: "すべての言語",
        },
        preview: "プレビュー言語",
        excluded: "{language}では使わない",
        builtin: {
            group: "組み込みフォント",
            systemUi: "システム UI フォント",
            sansSerif: "サンセリフ（汎用）",
            serif: "セリフ（汎用）",
            monospace: "等幅（汎用）",
            kind: {
                system: "システムフォント",
                sansSerif: "サンセリフ",
                serif: "セリフ",
                monospace: "等幅",
            },
        },
    },

    panel: {
        add: "色を追加",
        newColorName: "新しい色",
        nameLabel: "名前",
        editColor: "{name} を編集",
        deleteColor: "{name} を削除",
        delete: "削除",
        deleteConfirm: "「{name}」を削除する？",
        deleteUnused: "この色を使っている場所はない",
        // 起きることをそのまま書く。削除された色を指していた場所は書き換えられず、
        // 解決できないまま各自の既定色に戻る。プロジェクトの検査がその一覧を出す。
        deleteDetail: {
            other: "使っている {count} 箇所がそれぞれ自身の既定色に戻る",
        },
    },
} satisfies LocaleNamespace<"brand">;
