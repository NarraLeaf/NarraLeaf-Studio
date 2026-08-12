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
        // 解決できないまま各自の既定色に戻る。プロジェクト検査がその一覧を出す。
        deleteDetail: {
            other: "使っている {count} 箇所がそれぞれ自身の既定色に戻る",
        },
    },
} satisfies LocaleNamespace<"brand">;
