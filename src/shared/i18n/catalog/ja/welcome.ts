import type { LocaleNamespace } from "../types";

/**
 * `welcome` 日本語。
 *
 * 見出しは製品名を示し、副題は 3 つの入口を示す。もとの「はじめかた」4 ステップは削除済み。
 * その 4 つは `workspaceLayout`、`assets`、`storyScene`、`runModes` のヘルプトピックそのもので、
 * ページはそこへリンクするだけにしてある。
 */
export const welcome = {
    title: "NarraLeaf Studio へようこそ",
    subtitle: "シーンの作成、アセットライブラリ、ヘルプのいずれかから始められる",
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
