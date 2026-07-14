import type { LocaleNamespace } from "../types";

export const welcome = {
    tagline: "面向 NarraLeaf 项目的一体化 IDE",
    gettingStarted: {
        title: "快速开始",
        step1: {
            title: "熟悉工作区",
            description: "左侧边栏包含素材管理器及其他面板，右侧可添加属性检查器等其他工具",
        },
        step2: {
            title: "管理资源",
            description: "将图片、音频、视频等导入到资源面板",
        },
        step3: {
            title: "创建故事",
            description: "使用故事编辑器创建游戏场景和对话",
        },
        step4: {
            title: "预览运行",
            description: "点击运行按钮预览游戏效果，并按需调试和修改",
        },
    },
} satisfies LocaleNamespace<"welcome">;
