import type { LocaleNamespace } from "../types";

export const game = {
    saveLoad: {
        refused: "该存档无法读取。游戏从当前位置继续。",
        refusedOtherStory: "该存档来自另一个版本的故事。游戏从当前位置继续。",
        notApplied: "读取存档：「{id}」未生效，运行中的游戏保持不变。{detail}",
        putBack: "读取存档：「{id}」未生效，运行中的游戏已恢复。{detail}",
        notRestored: "读取存档：「{id}」未生效，运行中的游戏无法恢复。{detail}",
        otherStory: "读取存档：「{id}」来自另一个版本的故事。",
        relaunchedRow: "读取存档：「{id}」来自另一次构建，已从它停下的那一行重新开始故事。",
        relaunchedScene: "读取存档：「{id}」来自另一次构建，它停下的那一行已不存在，已从该场景开头重新开始故事。",
        detail: {
            unreadable: "该存档无法读取。{error}",
            missing: "该 id 下没有存档。",
            malformed: "存储的内容不是存档格式。",
            unsupported: "该存档的格式本次构建无法读取。",
            policy: "本工程不恢复来自另一次构建的旧存档。",
            unanchored: "该存档没有记录停在何处，无法从那里重新开始故事。",
            sceneGone: "该存档所在的场景不在本次构建里，无处重新开始。",
            relaunch: "无法从该存档停下的位置重新开始故事。{error}",
            unresolvedScene: "该存档所在的场景不在运行中的故事里。",
            unresolvedElement: "运行中的故事缺少该存档要放上舞台的内容。",
            unresolvedAction: "该存档停留的故事行不在运行中的故事里。",
            savedAt: "{detail}存档最后一行：{line}",
            engine: "{error}",
        },
    },
    crash: {
        title: "游戏已停止工作",
        detail: "存档不受影响。重新启动会回到游戏的标题画面。",
        restart: "重新启动",
        showDetails: "详细信息",
        copyDetails: "复制详情",
        copied: "已复制到剪贴板",
        copyFailed: "复制失败：{error}",
        logAt: "报告位于 {path}",
    },
} satisfies LocaleNamespace<"game">;
