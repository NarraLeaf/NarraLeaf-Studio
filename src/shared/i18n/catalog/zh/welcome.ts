import type { LocaleNamespace } from "../types";

/**
 * `welcome` 简体中文。
 *
 * 标题与副标题只打招呼，不解释。原来的「快速开始」四步已删除：那四步说的正是
 * `workspaceLayout`、`assets`、`storyScene`、`runModes` 四个帮助主题，页面改为链到它们，
 * 不再复述一遍。
 */
export const welcome = {
    title: "初次见面",
    subtitle: "欢迎使用NarraLeaf Studio，准备好开始了吗？",
    quickActions: {
        newScene: {
            label: "新建场景",
            description: "新增场景并开始编写",
        },
        openAssets: {
            label: "打开资源",
            description: "导入图片、音频与视频",
        },
        help: {
            label: "帮助",
            description: "Studio 各个部分的行为",
        },
    },
    reopenHint: {
        menu: "在「帮助 → 打开欢迎页」中重新打开本页",
        palette: "在命令面板中搜索「打开欢迎页」重新打开本页",
    },
} satisfies LocaleNamespace<"welcome">;
