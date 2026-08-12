import type { LocaleNamespace } from "../types";

export const placeholders = {
    story: {
        title: "ストーリー",
        description: "チャプター、シーン、ストーリーの構成がここに並ぶ",
    },
    localization: {
        title: "ローカライズ",
        description: "翻訳表と言語ごとのアセットをここで扱う",
    },
    // 読み込み時に登録される静的なパネル／エディタのモジュール名（各モジュールの index を参照）
    moduleTitles: {
        welcome: "ようこそ",
        project: "プロジェクト",
        properties: "プロパティ",
        characters: "キャラクター",
        story: "ストーリー",
        localization: "ローカライズ",
        voice: "ボイス",
        assets: "アセット",
        console: "コンソール",
        storyMotion: "ストーリーモーション",
        dashboard: "ダッシュボード",
        audioPreview: "音声プレビュー",
        imagePreview: "画像プレビュー",
        videoPreview: "動画プレビュー",
        fontPreview: "フォントプレビュー",
        jsonPreview: "JSON プレビュー",
        search: "検索",
        keybindings: "キーボードショートカット",
        history: "履歴",
        notifications: "通知",
        plugins: "プラグイン",
        variables: "変数",
    },
} satisfies LocaleNamespace<"placeholders">;
