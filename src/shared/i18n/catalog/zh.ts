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
    workspace: {
        localization: {
            panel: {
                languagesTitle: "语言",
                languagesHint: "游戏本身的语言列表。源语言是你写作所用的语言，其余语言以它为原文进行翻译。",
                empty: "还没有语言。先添加源语言。",
                addLanguage: "添加语言",
                codePlaceholder: "代码（en、ja、zh-CN…）",
                namePlaceholder: "显示名称",
                invalidCode: "语言代码只能包含字母、数字和连字符。",
                sourceBadge: "源语言",
                more: "更多",
                confirm: "确认",
                setSource: "设为源语言",
                removeLanguage: "移除语言",
                removeConfirm: "移除 {name}？",
                removeConfirmDetail: "翻译仍保留在磁盘上，重新添加该语言后会恢复。",
                openTable: "打开翻译表",
                progress: "已翻译 {completed}/{total}",
                staleCount: "{count} 条待复查",
                exportCsv: "导出 CSV",
                importCsv: "导入 CSV",
                exportDone: "已导出到 {path}",
                importSummary: "导入 {applied} 条译文（{unchanged} 条未变化，{unknown} 条未知条目，{skippedEmpty} 条空译文已跳过）",
                importFailed: "无法读取 CSV 文件",
            },
            table: {
                storyLabel: "范围",
                sourceUi: "界面文本",
                sourceKeys: "通用文本",
                emptyUi: "还没有标记为可本地化的界面文本。在文本或按钮控件上开启“本地化文本”。",
                modeTranslate: "翻译",
                modeReview: "审校",
                filterAll: "全部",
                filterUntranslated: "未翻译",
                filterStale: "待复查",
                filterCompleted: "已翻译",
                reviewFilterReviewed: "已审阅",
                reviewFilterUnreviewed: "未审阅",
                charactersGroup: "角色",
                characterSpeaker: "角色",
                addKey: "添加",
                keyNamePlaceholder: "键名（menu.start…）",
                keySourcePlaceholder: "源语言文案",
                invalidKeyName: "键名只能由字母、数字组成，中间可用点、下划线或连字符分隔。",
                removeKey: "移除键",
                removeKeyConfirm: "移除 {name}？",
                removeKeyConfirmDetail: "该键的已有译文仍保留在语言文件中。",
                sourceColumn: "原文",
                targetColumn: "译文",
                targetPlaceholder: "输入译文…",
                narrationSpeaker: "旁白",
                choiceSpeaker: "选项",
                markReviewed: "标记为已审校",
                unmarkReviewed: "退回已翻译",
                reviewApprove: "通过",
                reviewReturn: "退回",
                reviewPendingCount: "{count} 条待审",
                reviewAllClear: "全部审校完毕，没有待审条目。",
                staleHint: "翻译后原文已改动。复查后保存即重新锚定。",
                placeholderHint: "请保留 {n} 占位符——它们渲染内联值。",
                emptyStory: "这个故事还没有可翻译的文本。",
                emptyFilter: "没有符合当前筛选的条目。",
                noStories: "先创建一个故事——它的台词会出现在这里供翻译。",
                statusUntranslated: "未翻译",
                statusMachine: "机翻",
                statusTranslated: "已翻译",
                statusReviewed: "已审校",
                statusStale: "待复查",
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
