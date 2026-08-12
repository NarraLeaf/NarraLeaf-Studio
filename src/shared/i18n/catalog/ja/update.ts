import type { LocaleNamespace } from "../types";

/** `update` 日本語。ソフトウェア更新：設定パネル、ランチャーのバージョン横の 1 行、ワークスペースの通知、終了時のネイティブダイアログ。 */
export const update = {
    title: "更新",
    status: {
        idle: "NarraLeaf Studio は最新版",
        checking: "更新を確認中…",
        available: "バージョン {version} が公開されている",
        downloading: "バージョン {version} をダウンロード中…",
        ready: "バージョン {version} はインストールできる",
        error: "更新を確認できなかった",
        manual: "バージョン {version} をダウンロードできる",
    },
    versions: "使用中 {current}",
    actions: {
        check: "更新を確認",
        download: "更新をダウンロード",
        install: "再起動してインストール",
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
            label: "起動時に更新を確認",
            description: "Studio の起動直後に GitHub へ 1 回だけ問い合わせる。ダウンロードが自動で始まることはない",
        },
    },
    notification: {
        message: "NarraLeaf Studio {version} が公開されている",
        detail: "使用中は {current}",
        action: "更新を見る",
    },
    launcher: {
        available: "{version} に更新",
    },
    quitPrompt: {
        title: "更新の実行中",
        message: "NarraLeaf Studio が更新をダウンロードしている",
        detail: "今終了すると、ダウンロード済みの部分は破棄される",
        keepDownloading: "ダウンロードを続ける",
        quitAnyway: "終了する",
    },
} satisfies LocaleNamespace<"update">;
