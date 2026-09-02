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
        // 正式构建：折进下拉框，给版本控制控件腾出位置。
        productionBuild: "正式构建…",
        // 和「正式构建」并列，因为它们是同一类事：产出一个文件而不是把什么跑起来。
        exportPatch: "导出补丁…",
        runAs: "运行为",
            runWithDlc: "带 DLC 运行",
            dlcCount: "{active} / {total}",
        // 预览是否按受保护构建的方式存放内容。仅在项目开启资产保护时出现，且默认关闭。
        previewAsShipped: "按出货方式预览",
        previewAsShippedDetail: "预览按玩家收到的受保护形式运行，启动更慢",
        // 同一个选择在 Run 按钮上的写法，避免封库的预览被当成普通预览。
        asShipped: "出货形式",
        // 清除一次运行留下的存档与持久化数据，用于游戏自身让该状态出错、启动即崩溃时。开发模式与预览各存各的，
        // 子菜单只重置其中一个，不影响另一个。
        resetData: "重置玩家数据",
        // 正在运行的那个模式对应的行，置灰:在运行进程之下重置会与它的下一次写入发生竞争。
        resetWhileRunning: "停止后可重置其数据",
        resetDevModeConfirm: "重置开发模式的玩家数据",
        resetPreviewConfirm: "重置预览的玩家数据",
        resetDetail: "该项目的所有存档与持久化数据将被清除",
        resetDone: "玩家数据已重置",
        resetFailed: "无法重置玩家数据",
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
        revealProject: {
            label: "打开项目所在位置",
            tooltip: "在文件管理器中显示本项目的文件夹",
            failed: "无法打开项目文件夹",
        },
        returnToLauncher: {
            label: "返回启动器",
            tooltip: "离开当前项目，回到启动器",
        },
        close: {
            label: "关闭窗口",
            tooltip: "关闭当前窗口",
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
        chooseFolder: "选择导出项目包的存放文件夹",
        failed: "导出项目失败",
        success: {
            one: "已导出包含 {count} 个文件的项目包",
            other: "已导出包含 {count} 个文件的项目包",
        },
    },
} satisfies LocaleNamespace<"actions">;
