import type { LocaleNamespace } from "../types";

/** `update` 日本語。ソフトウェア更新：設定パネル、ランチャーのバージョン横の 1 行、ワークスペースの通知、終了時のネイティブダイアログ。 */
export const update = {
    title: "更新",
    status: {
        idle: "NarraLeaf Studio は最新版",
        checking: "更新を確認中…",
        available: "バージョン {version} が公開されている",
        downloading: "バージョン {version} をダウンロード中…",
        preparing: "バージョン {version} を準備中…",
        ready: "バージョン {version} はインストールできる",
        readyFast: "バージョン {version} の準備完了",
        error: "更新を確認できなかった",
        failed: "バージョン {version} をダウンロードできなかった",
        manual: "バージョン {version} をダウンロードできる",
    },
    versions: "使用中 {current}",
    readyHint: "Studio の終了時にも適用される",
    indicator: {
        label: "ソフトウェア更新",
    },
    actions: {
        check: "更新を確認",
        download: "更新をダウンロード",
        install: "再起動してインストール",
        restart: "再起動して更新",
        cancel: "更新を中止",
        releaseNotes: "リリースノート",
        openDownloadPage: "ダウンロードページを開く",
    },
    unsupported: {
        macos: "macOS では Studio 自身が更新をインストールできない。新しいバージョンをダウンロードしてアプリを置き換える",
        development: "開発ビルドは自身を更新できない",
        platform: "このビルドは自身で更新をインストールできない。リリースページから新しいバージョンをダウンロードする",
    },
    setting: {
        checkOnLaunch: {
            label: "更新を自動で確認",
            description: "Studio の起動直後と、起動中は数時間ごとに GitHub へ問い合わせる",
        },
        autoDownload: {
            label: "更新を自動でダウンロード",
            description: "新しいバージョンをバックグラウンドでダウンロードして準備する。Studio を再起動すると適用される",
        },
    },
    notification: {
        message: "NarraLeaf Studio {version} が公開されている",
        detail: "使用中は {current}",
        action: "更新を見る",
        readyMessage: "NarraLeaf Studio {version} の準備完了",
        readyDetail: "再起動すると更新が完了する",
    },
    launcher: {
        available: "{version} に更新",
        progress: "{version} に更新中…",
        ready: "再起動して {version} に更新",
    },
    quitPrompt: {
        title: "更新の実行中",
        message: "NarraLeaf Studio が更新をダウンロードしている",
        detail: "今終了すると、ダウンロード済みの部分は破棄される",
        keepDownloading: "ダウンロードを続ける",
        quitAnyway: "終了する",
    },
} satisfies LocaleNamespace<"update">;
