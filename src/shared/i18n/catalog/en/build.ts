/** `build` — production build dialog, platform/format labels, and status toasts. */
export const build = {
    dialog: {
        title: "Build for distribution",
        start: "Build",
        runningTitle: "Build in progress",
        runningBody: "A build is already running for this project. Watch its progress in the console.",
        viewConsole: "View console",
        cancelBuild: "Cancel build",
    },
    platform: {
        windows: "Windows",
        macos: "macOS",
        linux: "Linux",
    },
    unavailable: {
        windows: "Cannot build Windows apps on this machine.",
        macos: "macOS apps can only be built on a Mac.",
        linux: "Cannot build Linux apps on this machine.",
    },
    format: {
        zip: "Portable ZIP",
        nsis: "Installer",
        dmg: "Disk image",
        appimage: "AppImage",
        dir: "Folder",
    },
    outputDir: "Output folder",
    chooseFolder: "Choose folder…",
    info: {
        version: "Version",
        protection: "Asset protection",
        protectionOn: "On",
        protectionOff: "Off",
    },
    unsignedNotice: "Builds are not code-signed. Players may see a security warning from macOS Gatekeeper or Windows SmartScreen the first time they open the game; a signing certificate is needed for a warning-free install.",
    selectAtLeastOne: "Select at least one platform and format.",
    toast: {
        done: "Build finished.",
        failed: "Build failed.",
    },
} as const;
