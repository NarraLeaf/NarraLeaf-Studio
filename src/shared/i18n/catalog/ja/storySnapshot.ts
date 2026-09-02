import type { LocaleNamespace } from "../types";

export const storySnapshot = {
    empty: "スナップショットを扱うにはストーリーのシーンを開く",
    defaults: "既定値",
    defaultsDetail: "各変数は宣言された値から始まる",
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
