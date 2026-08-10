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
        ready: "Version {version} is ready to install.",
        error: "Could not check for updates.",
        manual: "Version {version} is available to download.",
    },
    /** Sits under the status line: what the running build is, and what it would become. */
    versions: "Installed {current}",
    actions: {
        check: "Check for Updates",
        download: "Download Update",
        install: "Restart and Install",
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
            label: "Check for updates at launch",
            description: "Asks GitHub once, shortly after Studio starts. Downloads never begin on their own.",
        },
    },
    /** The workspace toast. Its action opens Settings; it never starts the download itself. */
    notification: {
        message: "NarraLeaf Studio {version} is available",
        detail: "You are running {current}.",
        action: "View update",
    },
    /** The launcher's line under the version number. */
    launcher: {
        available: "Update to {version}",
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
