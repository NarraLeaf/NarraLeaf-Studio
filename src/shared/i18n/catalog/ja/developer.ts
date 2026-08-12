import type { LocaleNamespace } from "../types";

/**
 * `developer` 日本語。ゲームを走らせるウィンドウの `devMode` とは別物で、
 * こちらは開発者オプションがコンテキストメニューの末尾に足す行。
 */
export const developer = {
    copyId: {
        surface: "{label} の ID をコピー",
        element: "要素の ID をコピー",
        asset: "アセットの ID をコピー",
        assetGroup: "グループの ID をコピー",
        character: "キャラクターの ID をコピー",
        characterGroup: "グループの ID をコピー",
        story: "ストーリーの ID をコピー",
        chapter: "チャプターの ID をコピー",
        scene: "シーンの ID をコピー",
        storyRow: "行の ID をコピー",
    },
    copied: "ID をコピーした",
    copyFailed: "ID をコピーできなかった",
} satisfies LocaleNamespace<"developer">;
