/**
 * `update` - software updates: the Settings panel, the line the launcher shows beside the version
 * number, the notification a workspace raises, and the native prompt shown when someone quits
 * mid-download.
 *
 * One namespace for all four because they describe one state machine (`UpdateState`), and text
 * that disagrees about what "downloading" means would be worse than text in the wrong place.
 */
export const update = {
    title: "Updates",
    /** Rows in the Settings panel. `{version}` is the version on offer. */
    status: {
        idle: "NarraLeaf Studio is up to date.",
        checking: "Checking for updates…",
        available: "Version {version} is available.",
        downloading: "Downloading version {version}…",
        preparing: "Preparing version {version}…",
        /** Downloaded, but not unpacked beside the running version: the restart runs the full install. */
        ready: "Version {version} is ready to install.",
        /** Unpacked beside the running version: the restart only swaps it in. */
        readyFast: "Version {version} is ready.",
        error: "Could not check for updates.",
        /** A version was found, and downloading or preparing it failed. */
        failed: "Version {version} could not be downloaded.",
        manual: "Version {version} is available to download.",
    },
    /** Sits under the status line: what the running build is, and what it would become. */
    versions: "Installed {current}",
    /** Under a ready update: the other way it gets applied. */
    readyHint: "Also applied when Studio quits.",
    /** The button in the workspace title bar, left of the dock toggles. */
    indicator: {
        label: "Software update",
    },
    actions: {
        check: "Check for Updates",
        download: "Download Update",
        install: "Restart and Install",
        restart: "Restart to Update",
        cancel: "Cancel Update",
        releaseNotes: "Release notes",
        openDownloadPage: "Open download page",
    },
    /**
     * Why a platform cannot install its own updates. Shown in place of the Download button rather
     * than as a disabled control - a button that cannot work explains nothing.
     */
    unsupported: {
        macos: "Studio cannot install its own updates on macOS yet. Download the new version and replace the app.",
        development: "A development build cannot update itself.",
        platform: "This build cannot install its own updates. Download the new version from the releases page.",
    },
    setting: {
        checkOnLaunch: {
            label: "Check for updates automatically",
            description: "Asks GitHub shortly after Studio starts, and every few hours while it runs.",
        },
        autoDownload: {
            label: "Download updates automatically",
            description: "A new version is downloaded and prepared in the background. Restarting Studio applies it.",
        },
    },
    /**
     * The workspace toasts. The first is raised only when nothing is downloading on its own
     * (automatic downloads off, or macOS); its action opens the title bar's update panel. The second
     * is raised once an update is ready, and its action restarts Studio to apply it.
     */
    notification: {
        message: "NarraLeaf Studio {version} is available",
        detail: "You are running {current}.",
        action: "View update",
        readyMessage: "NarraLeaf Studio {version} is ready",
        readyDetail: "Restart to finish updating.",
    },
    /** The launcher's line under the version number. */
    launcher: {
        available: "Update to {version}",
        progress: "Updating to {version}…",
        ready: "Restart to update to {version}",
    },
    /**
     * The native prompt shown when a quit would abandon a download in progress. Native rather
     * than in-app because by this point there may be no window left to draw it in - staying
     * resident with no windows is exactly the state a background download runs in.
     */
    quitPrompt: {
        title: "Update in progress",
        message: "NarraLeaf Studio is downloading an update.",
        detail: "Quitting now discards the part that has been downloaded.",
        keepDownloading: "Keep Downloading",
        quitAnyway: "Quit Anyway",
    },
} as const;
