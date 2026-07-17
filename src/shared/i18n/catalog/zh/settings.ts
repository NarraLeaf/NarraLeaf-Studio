import type { LocaleNamespace } from "../types";

export const settings = {
    title: "设置",
    searchPlaceholder: "搜索设置…",
    loading: "正在加载设置…",
    noResults: "没有匹配的设置",
    empty: "暂无可用设置",
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
        themeMode: {
            label: "主题",
            description: "Studio 界面的配色主题，“跟随系统”会随操作系统切换",
            options: {
                auto: "跟随系统",
                light: "亮色",
                dark: "暗色",
            },
        },
        zoomPercent: {
            label: "界面缩放",
            description: "Studio 界面的缩放比例（{min}%-{max}%）",
        },
        editorFontSize: {
            label: "故事编辑器字号",
            description: "故事场景编辑器中对话、旁白与选项文本的字号（px，{min}–{max}）",
        },
        editorFontFamily: {
            label: "故事编辑器字体",
            description: "场景编辑器中故事文本所用的字体",
        },
        maxActiveEditors: {
            label: "最大活动编辑器数",
            description: "同时保持加载的编辑器标签数，切换标签时保留其滚动位置与焦点（{min}–{max}），超出的标签会在重新打开时重新加载",
        },
        electronMirror: {
            label: "Electron 下载镜像",
            description: "为其他平台构建游戏时下载 Electron 所用的镜像地址，留空则使用官方源",
        },
        confirmBeforeClose: {
            label: "关闭工作区时弹出提示",
            description: "关闭工作区窗口时先询问确认",
        },
        returnToLauncherOnClose: {
            label: "关闭工作区后返回首页",
            description: "关闭工作区后回到首页，关闭此项则在没有其他窗口时直接退出 NarraLeaf Studio",
        },
        dashboardOnOpen: {
            label: "默认显示项目仪表盘",
            description: "尚未单独设置过的项目，进入工作区时是否自动打开仪表盘标签页。可在各项目的仪表盘底部单独调整",
        },
        clearAllStats: {
            label: "清空所有统计数据",
            description: "抹除所有项目已记录的写作历史、活跃时长和构建历史。从项目本身算出的统计数字不受影响",
            action: "清空",
            confirm: "确认清空",
        },
    },
} satisfies LocaleNamespace<"settings">;
