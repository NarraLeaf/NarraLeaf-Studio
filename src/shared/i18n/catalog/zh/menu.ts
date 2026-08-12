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
        holdToQuit: "按住 ⌘Q 退出",
    },
    tray: {
        openLauncher: "打开启动器",
        checkForUpdates: "检查更新…",
        quit: "退出 {name}",
        residencyNotice: {
            title: "NarraLeaf Studio 仍在运行",
            body: "它留在通知区域，以便下载和更新继续完成。右键单击图标可重新打开或退出。",
        },
    },
    file: {
        title: "文件",
        new: "新建工作区",
        open: "打开工作区",
        openRecent: "最近打开的工作区",
        noRecent: "无最近工作区",
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
    // 这里只留菜单自己的标题。菜单里的每一项都复用运行下拉框的文案
    //（`actions.run.*`、`test.action.*`），免得同样的四件事在两处叫两个名字。
    dev: {
        title: "开发",
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
        feedback: "问题反馈",
        about: "关于 {name}",
    },
} satisfies LocaleNamespace<"menu">;
