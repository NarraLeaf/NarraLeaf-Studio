import type { LocaleNamespace } from "../types";

export const actions = {
    devMode: {
        tooltip: "開発モード",
    },
    preview: {
        tooltip: "プレビュー",
    },
    build: {
        tooltip: "プロジェクトをビルド",
    },
    run: {
        devMode: "開発モード",
        preview: "プレビュー",
        runDevMode: "開発モードで実行",
        runPreview: "プレビューを実行",
        switchMode: "実行モードを切り替え",
        menu: "実行とビルド",
        productionBuild: "製品ビルド…",
            exportPatch: "パッチを書き出す",
        runAs: "実行するバリアント",
    },
    file: {
        label: "ファイル",
        new: {
            label: "新規ワークスペース",
            tooltip: "ワークスペースを新規作成",
        },
        open: {
            label: "ワークスペースを開く",
            tooltip: "既存のワークスペースを開く",
        },
        export: {
            label: "プロジェクトを書き出す",
            tooltip: "現在のプロジェクトをパッケージとして書き出す",
        },
        close: {
            tooltip: "現在のワークスペースを閉じる",
        },
    },
    help: {
        label: "ヘルプ",
        welcome: {
            label: "ようこそページを開く",
            tooltip: "ようこそ画面を開く",
        },
        about: {
            label: "このアプリについて",
            tooltip: "NarraLeaf Studio について",
        },
    },
    export: {
        chooseFolder: "書き出したプロジェクトパッケージを置くフォルダを選ぶ",
        failed: "プロジェクトを書き出せなかった",
        success: {
            other: "ファイル {count} 件を含むプロジェクトパッケージを書き出した",
        },
    },
} satisfies LocaleNamespace<"actions">;
