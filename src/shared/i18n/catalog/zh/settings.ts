import type { LocaleNamespace } from "../types";

export const settings = {
    title: "设置",
    subtitle: "编辑器设置",
    searchPlaceholder: "搜索设置…",
    loading: "正在加载设置…",
    noResults: "没有匹配的设置",
    empty: "暂无可用设置。",
    noneExposed: "当前没有已实装的设置可供配置",
    categories: {
        general: {
            label: "常规",
            description: "应用默认项、语言与通知",
        },
        appearance: {
            label: "外观",
            description: "界面主题、强调色与动效偏好",
        },
        editor: {
            label: "编辑器",
            description: "字体渲染、行号、自动换行与布局默认值",
        },
        workspace: {
            label: "工作区",
            description: "启动行为、工作区历史与自动保存",
        },
        sync: {
            label: "同步",
            description: "本地备份频率与同步辅助项",
        },
        advanced: {
            label: "高级",
            description: "遥测、开发者辅助与实验性开关",
        },
    },
    items: {
        language: {
            label: "语言",
            description: "Studio 界面的显示语言",
        },
    },
} satisfies LocaleNamespace<"settings">;
