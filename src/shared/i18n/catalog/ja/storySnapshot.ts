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
    launch: {
        needSnapshot: "ここからゲームを始めるにはスナップショットが必要",
        needSnapshotDetail: "行から再生するには変数の具体的な値が必要。先にシーンのスナップショットを作成する",
        createAction: "スナップショットを作成",
        distrusted: "このプロジェクトは信頼されていないため、ここからゲームを始められない",
        distrustedDetail: "行から再生するとプロジェクトが実行される。設定で信頼すると始められる",
    },
} satisfies LocaleNamespace<"storySnapshot">;
