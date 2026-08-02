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
    customColor: "自定义颜色…",
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
        plugins: {
            label: "插件",
            description: "插件商店与注册表",
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
            description: "Studio 界面的配色主题",
            options: {
                auto: "跟随系统",
                light: "亮色",
                dark: "暗色",
            },
        },
        accentColor: {
            label: "强调色",
            description: "选中项、焦点框和主要按钮所用的颜色",
            options: {
                teal: "叶青",
                sky: "天蓝",
                indigo: "靛蓝",
                rose: "玫瑰",
                slate: "石板",
            },
        },
        reduceMotion: {
            label: "减少动效",
            description: "关闭 Studio 界面中的动画过渡，不影响你的游戏本身的动画",
        },
        zoomPercent: {
            label: "界面缩放",
            description: "Studio 界面的缩放比例（{min}%-{max}%）",
        },
        editorFontSize: {
            label: "故事编辑器字号",
            description: "场景编辑器中故事文本的字号（px，{min}-{max}）",
        },
        editorFontFamily: {
            label: "故事编辑器字体",
            description: "场景编辑器中故事文本所用的字体",
        },
        editorSurfaceOpacity: {
            label: "编辑面不透明度",
            description: "故事正文与检查器字段背后阅读面的不透明度",
        },
        maxActiveEditors: {
            label: "最大活动编辑器数",
            description: "同时保持加载、保留滚动位置与焦点的编辑器标签数（{min}-{max}），其余的重新打开时会重新加载",
        },
        blueprintDragConnectExecOutput: {
            label: "从执行输出引脚拖拽创建节点",
            description: "拖到空白画布松手即可挑选节点，它会被接在该引脚之后",
        },
        blueprintDragConnectDataOutput: {
            label: "从数据输出引脚拖拽创建节点",
            description: "拖到空白画布松手即可挑选节点，菜单只列出能接收该数据类型的节点",
        },
        blueprintDragConnectInput: {
            label: "从输入引脚拖拽创建节点",
            description: "拖到空白画布松手即可挑选节点，它的输出会连到该引脚",
        },
        slashAtAlias: {
            label: "用“@”打开动作创建",
            description: "以防中文输入法的「/」与「、」冲突",
        },
        localizedCommands: {
            label: "指令跟随界面语言",
            description: "关掉它，动作创建里的指令名、参数名与取值保持英文。无论显示哪种语言，英文写法始终可用",
        },
        electronMirror: {
            label: "Electron 下载镜像",
            description: "下载 Electron 所用的镜像地址，留空则使用官方源",
        },
        pluginRegistryUrl: {
            label: "注册表地址",
            description: "插件商店从哪里取索引，留空则使用 NarraLeaf 官方注册表",
        },
        uiTemplateRegistryUrl: {
            label: "界面模板注册表地址",
            description: "模板商店从哪里取索引，留空则使用 NarraLeaf 官方注册表",
        },
        checkpointInterval: {
            label: "自动检查点间隔",
            description: "间隔多久记录一个检查点，只在确实有改动时记录。填 0 则关闭",
        },
        checkpointOnClose: {
            label: "关闭工作区时记录检查点",
            description: "关窗时记录一次，与上面的间隔各自独立",
        },
        versionControlAuthor: {
            label: "作者名",
            description: "记录为提交与检查点的作者，留空则记为 NarraLeaf Studio",
        },
        versionControlAuthorEmail: {
            label: "作者邮箱",
            description: "与作者名一起记录，形如「作者名 <邮箱>」，留空则不记录地址",
        },
        confirmBeforeClose: {
            label: "关闭工作区时弹出提示",
            description: "关闭工作区窗口时先询问确认",
        },
        returnToLauncherOnClose: {
            label: "关闭工作区后返回首页",
            description: "关闭此项则在没有其他窗口时直接退出 NarraLeaf Studio",
        },
        dashboardOnOpen: {
            label: "默认显示项目仪表盘",
            description: "对尚未单独设置过的项目生效，各项目可自行覆盖",
        },
        clearAllStats: {
            label: "清空所有统计数据",
            description: "抹除所有项目的写作历史、活跃时长和构建历史。从项目本身算出的数字不受影响",
            action: "清空",
            confirm: "确认清空",
        },
        statusBarVisible: {
            label: "显示状态栏",
            description: "工作区底部的那一条",
        },
        titleBarSearchVisible: {
            label: "显示标题栏搜索框",
            description: "标题栏中间的搜索框",
        },
        backgroundImage: {
            label: "自定义背景图",
            description: "在工作区背后显示一张你选择的图片",
            action: "配置…",
            needsWorkspace: "必须打开一个工作区才能配置背景图",
        },
        keybindings: {
            label: "快捷键",
        },
    },
} satisfies LocaleNamespace<"settings">;
