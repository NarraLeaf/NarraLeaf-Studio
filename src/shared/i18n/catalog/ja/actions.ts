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
        // 「製品ビルド」の隣。どちらも何かを起動するのではなくファイルを作る、同じ種類のもの。
        exportPatch: "パッチを書き出す…",
        runAs: "実行するバリアント",
            runWithDlc: "DLC 付きで実行",
            dlcCount: "{active} / {total}",
        // 実行が残すセーブと永続データを消す。ゲーム自身がその状態を壊し、起動時にクラッシュするときのための操作。
        // 開発モードとプレビューは別々に持つので、サブメニューは片方だけをリセットする。
        resetData: "プレイヤーデータをリセット",
        // いま実行中のモードの行は無効。動いているプロセスの下でリセットすると、その次の書き込みと競合する。
        resetWhileRunning: "停止するとそのデータをリセットできる",
        resetDevModeConfirm: "開発モードのプレイヤーデータをリセットするか",
        resetPreviewConfirm: "プレビューのプレイヤーデータをリセットするか",
        resetDetail: "このプロジェクトのすべてのセーブと永続データが削除される",
        resetDone: "プレイヤーデータをリセットした",
        resetFailed: "プレイヤーデータをリセットできなかった",
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
        revealProject: {
            label: "プロジェクトの場所を開く",
            tooltip: "このプロジェクトのフォルダーをファイルマネージャーで表示する",
            failed: "プロジェクトフォルダーを開けない",
        },
        returnToLauncher: {
            label: "ランチャーに戻る",
            tooltip: "このプロジェクトを離れてランチャーに戻る",
        },
        close: {
            label: "ウインドウを閉じる",
            tooltip: "このウインドウを閉じる",
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
