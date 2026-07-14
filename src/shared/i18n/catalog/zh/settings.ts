import type { LocaleNamespace } from "../types";

export const settings = {
    title: "设置",
    subtitle: "编辑器设置",
    searchPlaceholder: "搜索设置…",
    loading: "正在加载设置…",
    noResults: "没有匹配的设置",
    empty: "暂无可用设置。",
    noneExposed: "当前没有已实装的设置可供配置",
    invalidValue: "请输入有效的值",
    persistFailed: "保存设置失败",
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
        editorFontSize: {
            label: "故事编辑器字号",
            description: "故事场景编辑器中对话、旁白与选项文本的字号（px，{min}–{max}）。",
        },
        editorFontFamily: {
            label: "故事编辑器字体",
            description: "场景编辑器中故事文本所用的字体。",
        },
        maxActiveEditors: {
            label: "最大活动编辑器数",
            description:
                "同时保持加载的编辑器标签数，切换标签时保留其滚动位置与焦点（{min}–{max}）。超出的标签会在重新打开时重新加载。",
        },
    },
} satisfies LocaleNamespace<"settings">;
