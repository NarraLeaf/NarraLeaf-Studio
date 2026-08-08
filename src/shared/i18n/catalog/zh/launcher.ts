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
        // 是「添加」不是「新建」：这个按钮背后的向导还能解包安装包、从服务器克隆，
        // 那两条都不创建任何东西。
        addProject: "添加项目",
        openProject: "打开项目",
        recentTitle: "最近项目",
        openFolder: "打开文件夹",
        openNamed: "打开 {name}",
        search: {
            placeholder: "搜索项目",
            clear: "清除搜索",
            empty: "没有匹配“{query}”的项目。",
        },
        // 第一个项目出现之前的整个标签页，见 WelcomePane。
        // 第二块磁贴不复用 openFolder：那条在标题栏里要单独当 tooltip 用，
        // 这里两块并排是同一个选择，「打开…」的省略号才说明下一步会弹出文件对话框。
        // 第一块仍用 addProject，向导做的事不止「新建」。
        empty: {
            title: "欢迎使用NarraLeaf Studio",
            subtitle: "打开过的项目会显示在此处",
            openFolder: "打开…",
        },
        removeFromRecent: "从最近移除",
        moreActions: "更多操作",
        moreActionsNamed: "{name} 的更多操作",
        removeNamedFromRecent: "将 {name} 从最近项目中移除",
        errorCreate: "添加项目失败",
        errorOpenFolder: "打开文件夹失败",
        missing: {
            reasonFolderMissing: "此项目文件夹已被删除或移动",
            reasonNotAProject: "此文件夹已不是 NarraLeaf 项目",
            dialogTitle: "找不到此项目",
            note: "移除只会更新此列表，不会删除磁盘上的任何文件",
            relocate: "重新定位…",
            remove: "从列表移除",
            errorNotAProject: "所选文件夹不是 NarraLeaf 项目",
        },
    },
    // 中文只有一种复数形式，只需给出 other。
    recentCount: {
        other: "{count} 个最近项目",
    },
} satisfies LocaleNamespace<"launcher">;
