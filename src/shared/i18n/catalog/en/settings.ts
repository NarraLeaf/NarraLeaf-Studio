/** `settings` — the Settings window (registry-driven; see appSettings.ts). */
export const settings = {
    title: "Settings",
    searchPlaceholder: "Search settings…",
    loading: "Loading settings…",
    noResults: "No settings match your search.",
    empty: "No settings available.",
    noneExposed: "No implemented settings are currently exposed.",
    invalidValue: "Please provide a valid value",
    persistFailed: "Failed to persist setting",
    // Category chrome — keys mirror the category `key` in appSettings.ts.
    categories: {
        general: {
            label: "General",
            description: "Application defaults, language, and notifications.",
        },
        appearance: {
            label: "Appearance",
            description: "Interface theme, accent colors, and motion preferences.",
        },
        editor: {
            label: "Editor",
            description: "Font rendering, lines, wrapping and layout defaults.",
        },
        workspace: {
            label: "Workspace",
            description: "Startup behavior, workspace history, and auto-save helpers.",
        },
        sync: {
            label: "Sync",
            description: "Local backup cadence and synchronization helpers.",
        },
        advanced: {
            label: "Advanced",
            description: "Telemetry, developer helpers and experimental toggles.",
        },
    },
    // Individual settings — keyed by the setting they localize.
    items: {
        language: {
            label: "Language",
            description: "Display language for the Studio interface.",
        },
        themeMode: {
            label: "Theme",
            description: "Color theme for the Studio interface. \"Follow system\" switches with the operating system.",
            options: {
                auto: "Follow system",
                light: "Light",
                dark: "Dark",
            },
        },
        zoomPercent: {
            label: "Interface zoom",
            description: "Zoom level of the Studio interface ({min}%-{max}%).",
        },
        editorFontSize: {
            label: "Story editor font size",
            description:
                "Font size (px) for dialogue, narration, and choice text in the story scene editor ({min}–{max}).",
        },
        editorFontFamily: {
            label: "Story editor font",
            description: "Typeface used for story text in the scene editor.",
        },
        maxActiveEditors: {
            label: "Maximum active editors",
            description:
                "How many editor tabs stay loaded at once so their scroll position and focus are preserved when you switch between them ({min}–{max}). Tabs beyond this reload when reopened.",
        },
        electronMirror: {
            label: "Electron download mirror",
            description:
                "Mirror URL for downloading Electron when building games for other platforms. Leave empty to use the official source.",
        },
        confirmBeforeClose: {
            label: "Confirm before closing a workspace",
            description: "Ask for confirmation when you close a workspace window.",
        },
        returnToLauncherOnClose: {
            label: "Return to the home screen when closing a workspace",
            description:
                "Closing a workspace goes back to the home screen. Turn this off to quit NarraLeaf Studio instead when no other window is open.",
        },
        dashboardOnOpen: {
            label: "Show the project dashboard by default",
            description:
                "Whether projects you haven't decided about open their dashboard on entering the workspace. Each project can override this from its own dashboard.",
        },
        clearAllStats: {
            label: "Clear all statistics data",
            description:
                "Erase the recorded writing history, active time, and build history of every project. Counts derived from your projects are unaffected.",
            action: "Clear",
            confirm: "Clear everything",
        },
        openKeybindings: {
            label: "Keyboard shortcuts",
            description: "Customize keyboard shortcuts in the workspace's searchable binding table.",
            action: "Customize",
            needsWorkspace: "Open a workspace to customize keyboard shortcuts.",
        },
    },
} as const;
