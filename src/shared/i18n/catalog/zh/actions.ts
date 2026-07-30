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
    // 运行拆分按钮：承载当前所选模式的运行按钮，配一个用于切换模式的下拉框。
    run: {
        devMode: "开发模式",
        preview: "预览",
        runDevMode: "运行开发模式",
        runPreview: "运行预览",
        // 用于切换按钮运行哪种模式的下拉框；有模式在跑时模式项变灰。
        switchMode: "切换运行模式",
        // 同一个下拉框，现在还装着「正式构建」——所以它不再只关于切换模式，打开它的按钮也不能那么说。
        menu: "运行与构建",
        // 正式构建：折进下拉框，给版本控件腾出位置。
        productionBuild: "正式构建…",
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
