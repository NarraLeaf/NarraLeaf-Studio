import type { LocaleNamespace } from "../types";

/**
 * `welcome` 简体中文。
 *
 * 原来的标语与「快速开始」四步已删除：那四步说的正是 `workspaceLayout`、`assets`、
 * `storyScene`、`runModes` 四个帮助主题，页面改为链到它们，不再复述一遍。
 */
export const welcome = {
    quickActions: {
        newScene: {
            label: "新建场景",
            description: "加一个场景，开始写",
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
        menu: "在 帮助 → 打开欢迎页 可以回到这里",
        palette: "在命令面板搜索「打开欢迎页」可以回到这里",
    },
} satisfies LocaleNamespace<"welcome">;
