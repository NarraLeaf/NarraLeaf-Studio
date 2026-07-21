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
        menu: "您可以随时在 帮助 → 打开欢迎页 中查看此页",
        palette: "您可以随时在命令面板中搜索「打开欢迎页」查看此页",
    },
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
