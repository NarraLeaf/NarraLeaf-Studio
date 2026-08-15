import type { LocaleNamespace } from "../types";

/**
 * `welcome` 日本語。
 *
 * 見出しと副題はあいさつだけで、説明はしない。もとの「はじめかた」4 ステップは削除済み。
 * その 4 つは `workspaceLayout`、`assets`、`storyScene`、`runModes` のヘルプトピックそのもので、
 * ページはそこへリンクするだけにしてある。
 */
export const welcome = {
    title: "はじめまして",
    subtitle: "NarraLeaf Studio へようこそ。準備はいいですか",
    quickActions: {
        newScene: {
            label: "シーンを新規作成",
            description: "シーンを追加して書き始める",
        },
        openAssets: {
            label: "アセットを開く",
            description: "画像、音声、動画を読み込む",
        },
        help: {
            label: "ヘルプ",
            description: "Studio の各部分がどう動くか",
        },
    },
    reopenHint: {
        menu: "このページは「ヘルプ → ようこそページを開く」から開き直せる",
        palette: "このページはコマンドパレットで「ようこそページを開く」を検索すると開き直せる",
    },
} satisfies LocaleNamespace<"welcome">;
