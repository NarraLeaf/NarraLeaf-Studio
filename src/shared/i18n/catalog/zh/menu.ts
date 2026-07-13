import type { LocaleNamespace } from "../types";

export const menu = {
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
} satisfies LocaleNamespace<"menu">;
