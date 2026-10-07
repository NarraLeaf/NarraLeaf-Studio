import type { LocaleNamespace } from "../types";

/** `update` 简体中文。软件更新：设置面板、启动器版本号旁的一行、工作区通知、退出时的系统提示框。 */
export const update = {
    title: "更新",
    status: {
        idle: "NarraLeaf Studio 已是最新版本",
        checking: "正在检查更新…",
        available: "有新版本 {version}",
        downloading: "正在下载 {version}…",
        preparing: "正在准备 {version}…",
        ready: "{version} 已下载完成，可以安装",
        readyFast: "{version} 已准备就绪",
        error: "检查更新失败",
        failed: "{version} 下载失败",
        manual: "有新版本 {version} 可供下载",
    },
    errors: {
        connection: "无法连接到下载服务器（{reason}）",
    },
    versions: "当前版本 {current}",
    readyHint: "退出 Studio 时也会自动安装",
    indicator: {
        label: "软件更新",
    },
    actions: {
        check: "检查更新",
        download: "下载更新",
        install: "重启并安装",
        restart: "重启并更新",
        cancel: "取消更新",
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
            label: "自动检查更新",
            description: "Studio 启动后以及运行期间每隔数小时查询一次新版本",
        },
        autoDownload: {
            label: "自动下载更新",
            description: "在后台下载并准备新版本，重启 Studio 后生效",
        },
        source: {
            label: "更新下载源",
            description: "下载新版本所用的服务器。选择自动时会比较 GitHub 与 GitCode 的速度，使用较快的一个",
            options: {
                auto: "自动",
                gitcode: "GitCode（中国大陆）",
            },
        },
    },
    notification: {
        message: "NarraLeaf Studio {version} 可用",
        detail: "当前运行的是 {current}",
        action: "查看更新",
        readyMessage: "NarraLeaf Studio {version} 已准备就绪",
        readyDetail: "重启以完成更新",
    },
    launcher: {
        available: "更新到 {version}",
        progress: "正在更新到 {version}…",
        ready: "重启以更新到 {version}",
    },
    quitPrompt: {
        title: "更新正在进行",
        message: "NarraLeaf Studio 正在下载更新",
        detail: "现在退出会丢弃已下载的部分",
        keepDownloading: "继续下载",
        quitAnyway: "仍然退出",
    },
} satisfies LocaleNamespace<"update">;
