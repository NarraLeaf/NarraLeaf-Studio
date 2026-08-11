import type { LocaleNamespace } from "../types";

export const game = {
    saveLoad: {
        refused: "该存档无法读取。游戏从当前位置继续。",
        refusedOtherStory: "该存档来自另一个版本的故事。游戏从当前位置继续。",
        notApplied: "读取存档：「{id}」未生效，运行中的游戏保持不变。{detail}",
        putBack: "读取存档：「{id}」未生效，运行中的游戏已恢复。{detail}",
        notRestored: "读取存档：「{id}」未生效，运行中的游戏无法恢复。{detail}",
        otherStory: "读取存档：「{id}」来自另一个版本的故事。",
        detail: {
            unreadable: "该存档无法读取。{error}",
            missing: "该 id 下没有存档。",
            malformed: "存储的内容不是存档格式。",
            unresolved: "运行中的故事没有这些内容：{ids}。",
            engine: "{error}",
        },
    },
} satisfies LocaleNamespace<"game">;
