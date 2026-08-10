import type { LocaleNamespace } from "../types";

/**
 * `menu` 日本語。ネイティブのアプリケーションメニュー（メインプロセス、{@link menuManager.ts}）。
 *
 * `role:` 項目にも必ずラベルを書く。macOS は role 項目を *システム* の言語でしか訳さないので、
 * ここに無いとネイティブメニューだけアプリ内の言語設定を無視する。`{name}` はアプリの表示名。
 */
export const menu = {
    app: {
        about: "{name} について",
        preferences: "環境設定…",
        services: "サービス",
        hide: "{name} を隠す",
        hideOthers: "ほかを隠す",
        unhide: "すべてを表示",
        quit: "{name} を終了",
    },
    file: {
        title: "ファイル",
        new: "新規ワークスペース",
        open: "ワークスペースを開く",
        openRecent: "最近のワークスペースを開く",
        noRecent: "最近のワークスペースなし",
        export: "プロジェクトを書き出す",
        close: "ワークスペースを閉じる",
    },
    edit: {
        title: "編集",
        undo: "元に戻す",
        redo: "やり直す",
        cut: "切り取り",
        copy: "コピー",
        paste: "貼り付け",
        pasteAndMatchStyle: "貼り付けてスタイルを合わせる",
        delete: "削除",
        selectAll: "すべてを選択",
        speech: {
            title: "スピーチ",
            startSpeaking: "読み上げを開始",
            stopSpeaking: "読み上げを停止",
        },
    },
    dev: {
        title: "開発",
    },
    window: {
        title: "ウインドウ",
        minimize: "最小化",
        zoom: "ズーム",
        front: "すべてを手前に移動",
        leftSidebar: "サイドバーを表示",
        bottomPanel: "下部バーを表示",
        rightSidebar: "右バーを表示",
    },
    help: {
        title: "ヘルプ",
        welcome: "ようこそページを開く",
        docs: "ドキュメント",
        feedback: "フィードバックを送信",
        about: "{name} について",
    },
} satisfies LocaleNamespace<"menu">;
