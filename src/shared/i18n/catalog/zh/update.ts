import type { LocaleNamespace } from "../types";

/** `update` 简体中文。软件更新：设置面板、启动器版本号旁的一行、工作区通知、退出时的系统提示框。 */
export const update = {
    title: "更新",
    status: {
        idle: "NarraLeaf Studio 已是最新版本",
        checking: "正在检查更新…",
        available: "有新版本 {version}",
        downloading: "正在下载 {version}…",
        ready: "{version} 已下载完成，可以安装",
        error: "检查更新失败",
        manual: "有新版本 {version} 可供下载",
    },
    versions: "当前版本 {current}",
    actions: {
        check: "检查更新",
        download: "下载更新",
        install: "重启并安装",
        releaseNotes: "更新说明",
        openDownloadPage: "打开下载页",
    },
    unsupported: {
        macos: "Studio 目前无法在 macOS 上自行安装更新。请下载新版本并替换应用",
        development: "开发版本无法自行更新",
        platform: "此版本无法自行安装更新。请从发布页下载新版本",
    },
    setting: {
        checkOnLaunch: {
            label: "启动时检查更新",
            description: "在 Studio 启动后向 GitHub 查询一次。下载不会自动开始",
        },
    },
    notification: {
        message: "NarraLeaf Studio {version} 可用",
        detail: "当前运行的是 {current}",
        action: "查看更新",
    },
    launcher: {
        available: "更新到 {version}",
    },
    quitPrompt: {
        title: "更新正在进行",
        message: "NarraLeaf Studio 正在下载更新",
        detail: "现在退出会丢弃已下载的部分",
        keepDownloading: "继续下载",
        quitAnyway: "仍然退出",
    },
} satisfies LocaleNamespace<"update">;
