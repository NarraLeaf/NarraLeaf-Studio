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
            unresolvedScene: "该存档所在的场景不在运行中的故事里。",
            unresolvedElement: "运行中的故事缺少该存档要放上舞台的内容。",
            unresolvedAction: "该存档停留的故事行不在运行中的故事里。",
            savedAt: "{detail}存档最后一行：{line}",
            engine: "{error}",
        },
    },
} satisfies LocaleNamespace<"game">;
