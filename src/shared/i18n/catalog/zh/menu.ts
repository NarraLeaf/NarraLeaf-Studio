import type { LocaleNamespace } from "../types";

export const menu = {
    app: {
        about: "关于 {name}",
        preferences: "偏好设置…",
        services: "服务",
        hide: "隐藏 {name}",
        hideOthers: "隐藏其他",
        unhide: "全部显示",
        quit: "退出 {name}",
    },
    file: {
        title: "文件",
        new: "新建工作区",
        open: "打开工作区",
        export: "导出项目",
        close: "关闭工作区",
    },
    edit: {
        title: "编辑",
        undo: "撤销",
        redo: "重做",
        cut: "剪切",
        copy: "复制",
        paste: "粘贴",
        pasteAndMatchStyle: "粘贴并匹配样式",
        delete: "删除",
        selectAll: "全选",
        speech: {
            title: "语音",
            startSpeaking: "开始朗读",
            stopSpeaking: "停止朗读",
        },
    },
    dev: {
        title: "开发",
        devMode: "开发模式",
        preview: "预览模式",
        build: "构建发行版本",
    },
    window: {
        title: "窗口",
        minimize: "最小化",
        zoom: "缩放",
        front: "全部置于顶层",
        leftSidebar: "显示侧边栏",
        bottomPanel: "显示底边栏",
        rightSidebar: "显示右边栏",
    },
    help: {
        title: "帮助",
        welcome: "打开欢迎页",
        docs: "文档",
    },
} satisfies LocaleNamespace<"menu">;
