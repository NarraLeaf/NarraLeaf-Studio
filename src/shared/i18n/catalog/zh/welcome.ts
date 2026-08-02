import type { LocaleNamespace } from "../types";

export const welcome = {
    tagline: "面向 NarraLeaf 项目的一体化 IDE",
    quickActions: {
        newScene: {
            label: "新建场景",
            description: "为故事添加一个场景，开始写作",
        },
        openAssets: {
            label: "打开资源",
            description: "导入图片、音频与视频",
        },
        tutorials: {
            label: "查看教程",
            description: "在浏览器中打开 Studio 文档",
        },
    },
    reopenHint: {
        menu: "随时可以在 帮助 → 打开欢迎页 回到这里",
        palette: "随时可以在命令面板中搜索「打开欢迎页」回到这里",
    },
    gettingStarted: {
        title: "快速开始",
        step1: {
            title: "熟悉工作区",
            description: "面板在左侧边栏，检查器等工具放在右侧",
        },
        step2: {
            title: "管理资源",
            description: "把图片、音频与视频导入资源面板",
        },
        step3: {
            title: "创建故事",
            description: "在故事编辑器里写场景和对话",
        },
        step4: {
            title: "预览运行",
            description: "点运行就能试玩，看到改动的效果",
        },
    },
} satisfies LocaleNamespace<"welcome">;
