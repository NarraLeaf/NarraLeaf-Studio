import type { LocaleNamespace } from "../types";

export const actions = {
    devMode: {
        tooltip: "开发模式",
    },
    preview: {
        tooltip: "预览",
    },
    build: {
        tooltip: "构建项目",
    },
    file: {
        label: "文件",
        new: {
            label: "新建工作区",
            tooltip: "创建一个新工作区",
        },
        open: {
            label: "打开工作区",
            tooltip: "打开一个已有工作区",
        },
        export: {
            label: "导出项目",
            tooltip: "将当前项目导出为分发包",
        },
        close: {
            tooltip: "关闭当前工作区",
        },
    },
    help: {
        label: "帮助",
        welcome: {
            label: "打开欢迎页",
            tooltip: "打开欢迎界面",
        },
        about: {
            label: "关于",
            tooltip: "关于 NarraLeaf Studio",
        },
    },
    export: {
        chooseFolder: "请选择导出项目包的存放文件夹",
        failed: "导出项目失败",
        success: {
            one: "已导出包含 {count} 个文件的项目包",
            other: "已导出包含 {count} 个文件的项目包",
        },
    },
} satisfies LocaleNamespace<"actions">;
