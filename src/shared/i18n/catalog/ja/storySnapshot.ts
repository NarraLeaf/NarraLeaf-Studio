import type { LocaleNamespace } from "../types";

export const storySnapshot = {
    empty: "スナップショットを扱うにはストーリーのシーンを開く",
    getStarted: "開始時の値を決めるにはスナップショットを追加する",
    noVariables: "このシーンから見える変数がない",
    add: "スナップショットを追加",
    delete: "スナップショットを削除",
    defaultName: "スナップショット",
    nameAria: "スナップショット名",
    value: {
        true: "真",
        false: "偽",
    },
} satisfies LocaleNamespace<"storySnapshot">;
