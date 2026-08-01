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
        openFolder: "打开文件夹",
        importProject: "导入项目",
        // 从版本控制服务器上把工程取下来——第二个人就是这样加入一个工程的。
        // 放在启动器里，因为需要它的那一刻手边根本没有打开的工程。
        clone: {
            title: "从服务器获取工程",
            // 完整地址，含末尾的名字：那个名字才是服务器认得的仓库名，
            // 也正是工程的建立者发给你的那串东西。
            addressLabel: "工程地址",
            addressHint: "向建立这个工程的人要这个地址。",
            folderLabel: "放到哪里",
            folderPlaceholder: "选一个空文件夹",
            // 在选之前就说，而不是选完之后：这个判据在主进程里，
            // 到那时候才拒绝，是在作者已经认定要这么做之后才拒绝。
            folderHint: "必须是新建的或者空的文件夹。",
            confirm: "获取工程",
            cancel: "取消",
            // 没有百分比：后端要等整个 clone 结束才把进度事件交出来，
            // 画一根进度条只会停在 0 然后消失。
            working: "正在从服务器复制工程，可能需要一会儿。",
            error: "没能从服务器获取这个工程。",
        },
        openNamed: "打开 {name}",
        search: {
            placeholder: "搜索项目",
            clear: "清除搜索",
            empty: "没有匹配“{query}”的项目。",
        },
        removeFromRecent: "从最近移除",
        moreActions: "更多操作",
        moreActionsNamed: "{name} 的更多操作",
        removeNamedFromRecent: "将 {name} 从最近项目中移除",
        errorCreate: "创建项目失败",
        errorOpenFolder: "打开文件夹失败",
        errorImport: "导入项目失败",
        missing: {
            reasonFolderMissing: "此项目文件夹已被删除或移动",
            reasonNotAProject: "此文件夹已不是 NarraLeaf 项目",
            dialogTitle: "找不到此项目",
            note: "移除只会更新此列表，不会删除磁盘上的任何文件。",
            relocate: "重新定位…",
            remove: "从列表移除",
            errorNotAProject: "所选文件夹不是 NarraLeaf 项目。",
        },
    },
    // 中文只有一种复数形式，只需给出 other。
    recentCount: {
        other: "{count} 个最近项目",
    },
    plugins: {
        installLocal: "从文件夹安装",
        search: {
            placeholder: "搜索插件",
            clear: "清除搜索",
        },
        tab: {
            installed: "已安装",
            store: "商店",
        },
        emptyList: "尚未安装插件",
        emptyFiltered: "没有匹配“{query}”的插件。",
        authorize: "授权",
        uninstall: "卸载",
        builtIn: "内置",
        permissions: "权限",
        noPermissions: "无特殊权限",
        updateAvailable: "有可用更新",
        requiresStudio: "此插件需要 Studio {range}，当前版本为 {version}。",
        openReleasePage: "查看发行说明",
        homepage: "主页",
        field: {
            status: "状态",
            version: "版本",
            publisher: "发布者",
            entries: "入口",
            categories: "分类",
            installed: "安装时间",
            updated: "更新时间",
        },
        status: {
            enabled: "已启用",
            disabled: "已禁用",
            needsAuthorization: "待授权",
        },
        store: {
            install: "安装",
            installed: "已安装",
            update: "更新",
            needsStudio: "需要 Studio {range}",
            emptyList: "注册表中暂无可用插件。",
            offline: "无法连接到插件注册表。",
            retry: "重试",
        },
        task: {
            installing: "正在安装插件…",
            downloading: "正在下载插件…",
            installed: "插件已安装",
            authorizing: "等待授权…",
            authorized: "插件已授权",
            enabling: "正在启用插件…",
            disabling: "正在禁用插件…",
            enabled: "插件已启用",
            disabled: "插件已禁用",
            uninstalling: "正在卸载插件…",
            uninstalled: "插件已卸载",
        },
        error: {
            load: "加载插件失败",
            install: "安装插件失败",
            approve: "授权插件失败",
            update: "更新插件失败",
            uninstall: "卸载插件失败",
            registry: "无法连接到插件注册表",
            download: "下载插件失败",
        },
    },
    learning: {
        hint: "使用 NarraLeaf 创作所需的教程、示例与文档，链接会在浏览器中打开",
        openInBrowser: "在浏览器中打开 {name}",
        categories: {
            tutorials: "教程",
            examples: "示例",
            docs: "文档",
        },
    },
} satisfies LocaleNamespace<"launcher">;
