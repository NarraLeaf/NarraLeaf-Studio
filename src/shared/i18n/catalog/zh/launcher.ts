import type { LocaleNamespace } from "../types";

export const launcher = {
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
        openFolder: "打开文件夹",
        importProject: "导入项目",
        openNamed: "打开 {name}",
        removeFromRecent: "从最近移除",
        removeNamedFromRecent: "将 {name} 从最近项目中移除",
        errorCreate: "创建项目失败。",
        errorOpenFolder: "打开文件夹失败。",
        errorImport: "导入项目失败。",
    },
    // 中文只有一种复数形式，只需给出 other。
    recentCount: {
        other: "{count} 个最近项目",
    },
    plugins: {
        installLocal: "安装本地插件",
        emptyList: "尚未安装插件",
        noneSelected: "未选择插件",
        authorize: "授权",
        uninstall: "卸载",
        builtIn: "内置",
        permissions: "权限",
        field: {
            status: "状态",
            entries: "入口",
            installed: "安装时间",
            updated: "更新时间",
        },
        status: {
            enabled: "已启用",
            disabled: "已禁用",
            needsAuthorization: "待授权",
        },
        task: {
            installing: "正在安装插件…",
            installed: "插件已安装。",
            authorizing: "等待授权…",
            authorized: "插件已授权。",
            enabling: "正在启用插件…",
            disabling: "正在禁用插件…",
            enabled: "插件已启用。",
            disabled: "插件已禁用。",
            uninstalling: "正在卸载插件…",
            uninstalled: "插件已卸载。",
        },
        error: {
            load: "加载插件失败",
            install: "安装插件失败",
            approve: "授权插件失败",
            update: "更新插件失败",
            uninstall: "卸载插件失败",
        },
    },
    learning: {
        placeholder: "这里将显示教程、文档和示例（占位）。",
    },
} satisfies LocaleNamespace<"launcher">;
