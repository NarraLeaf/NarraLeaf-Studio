import type { LocaleMessages } from "./types";

/**
 * 简体中文目录（演示用）。
 *
 * 这是一份"较完整"的示范翻译：覆盖 common / menu / settings.general / launcher。
 * 未翻译的键会在运行时自动回退到英文源目录，因此可以增量翻译。
 * 类型为 LocaleMessages —— 允许缺键，但拼错键名或写错结构会编译报错。
 */
export const zh = {
    common: {
        appName: "NarraLeaf Studio",
        ok: "确定",
        cancel: "取消",
        save: "保存",
        reset: "重置",
        close: "关闭",
        loading: "加载中…",
    },
    menu: {
        app: {
            preferences: "偏好设置…",
        },
        file: {
            title: "文件",
            new: "新建工作区",
            open: "打开工作区",
            export: "导出项目",
            close: "关闭工作区",
        },
        view: {
            title: "视图",
        },
        window: {
            title: "窗口",
        },
        help: {
            title: "帮助",
            welcome: "打开欢迎页",
            docs: "文档",
        },
    },
    settings: {
        title: "设置",
        subtitle: "编辑器设置",
        searchPlaceholder: "搜索设置…",
        loading: "正在加载设置…",
        noResults: "没有匹配的设置。",
        empty: "暂无可用设置。",
        noneExposed: "当前没有已实装的设置可供配置。",
        categories: {
            general: {
                label: "常规",
                description: "应用默认项、语言与通知。",
            },
            appearance: {
                label: "外观",
                description: "界面主题、强调色与动效偏好。",
            },
            editor: {
                label: "编辑器",
                description: "字体渲染、行号、自动换行与布局默认值。",
            },
            workspace: {
                label: "工作区",
                description: "启动行为、工作区历史与自动保存。",
            },
            sync: {
                label: "同步",
                description: "本地备份频率与同步辅助项。",
            },
            advanced: {
                label: "高级",
                description: "遥测、开发者辅助与实验性开关。",
            },
        },
        items: {
            language: {
                label: "语言",
                description: "Studio 界面的显示语言。",
            },
        },
    },
    launcher: {
        nav: {
            projects: "项目",
            plugins: "插件",
            learning: "学习",
            settings: "设置",
        },
        projects: {
            title: "项目",
            newProject: "新建项目",
            openProject: "打开项目",
            import: "导入",
            recentTitle: "最近项目",
            empty: "还没有最近打开的项目。",
        },
        // 中文只有一种复数形式，只需给出 other。
        recentCount: {
            other: "{count} 个最近项目",
        },
    },
} satisfies LocaleMessages;
