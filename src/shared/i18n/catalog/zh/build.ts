import type { LocaleNamespace } from "../types";

export const build = {
    dialog: {
        title: "构建发行版本",
        start: "开始构建",
        runningTitle: "构建进行中",
        runningBody: "该项目已有一个构建在运行，请在控制台查看进度",
        viewConsole: "查看控制台",
        cancelBuild: "取消构建",
    },
    platform: {
        windows: "Windows",
        macos: "macOS",
        linux: "Linux",
    },
    unavailable: {
        windows: "当前设备无法构建 Windows 版本",
        macos: "macOS 版本只能在 Mac 上构建",
        linux: "当前设备无法构建 Linux 版本",
    },
    format: {
        zip: "便携 ZIP",
        nsis: "安装程序",
        dmg: "磁盘映像",
        appimage: "AppImage",
        dir: "文件夹",
    },
    outputDir: "输出目录",
    chooseFolder: "选择文件夹…",
    info: {
        version: "版本",
        protection: "资源保护",
        protectionOn: "已开启",
        protectionOff: "未开启",
    },
    unsignedNotice: "构建产物未做代码签名。玩家首次打开游戏时，macOS Gatekeeper 或 Windows SmartScreen 可能弹出安全提示；要获得无提示的安装体验需要签名证书",
    selectAtLeastOne: "请至少选择一个平台和格式",
    toast: {
        done: "构建完成",
        failed: "构建失败",
    },
} satisfies LocaleNamespace<"build">;
