import type { LocaleNamespace } from "../types";

export const placeholders = {
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
        problems: "問題",
        agentLog: "エージェントログ",
        storyMotion: "ストーリーモーション",
        dashboard: "ダッシュボード",
        search: "検索",
        keybindings: "キーボードショートカット",
        history: "履歴",
        notifications: "通知",
        plugins: "プラグイン",
        variables: "変数",
        dictionary: "辞書",
        collaboration: "コラボレーション",
    },
} satisfies LocaleNamespace<"placeholders">;
