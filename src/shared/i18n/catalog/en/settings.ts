/** `settings` - the Settings window (registry-driven; see appSettings.ts). */
export const settings = {
    title: "Settings",
    searchPlaceholder: "Search settings…",
    loading: "Loading settings…",
    noResults: "No settings match your search.",
    empty: "No settings available.",
    noneExposed: "No implemented settings are currently exposed.",
    invalidValue: "Please provide a valid value",
    persistFailed: "Failed to persist setting",
    customColor: "Custom color…",
    // Category chrome - keys mirror the category `key` in appSettings.ts.
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
        plugins: {
            label: "Plugins",
            description: "Plugin store and registry.",
        },
        advanced: {
            label: "Advanced",
            description: "Telemetry, developer helpers and experimental toggles.",
        },
    },
    // Individual settings - keyed by the setting they localize.
    items: {
        language: {
            label: "Language",
            description: "Display language for the Studio interface.",
        },
        themeMode: {
            label: "Theme",
            description: "Color theme for the Studio interface.",
            options: {
                auto: "Follow system",
                light: "Light",
                dark: "Dark",
            },
        },
        accentColor: {
            label: "Accent color",
            description: "Color used for selection, focus rings, and primary buttons.",
            options: {
                teal: "Leaf teal",
                sky: "Sky",
                indigo: "Indigo",
                rose: "Rose",
                slate: "Slate",
            },
        },
        reduceMotion: {
            label: "Reduce motion",
            description: "Turn off animated transitions in the Studio interface. Your game's own animations are unaffected.",
        },
        zoomPercent: {
            label: "Interface zoom",
            description: "Zoom level of the Studio interface ({min}%-{max}%).",
        },
        editorFontSize: {
            label: "Story editor font size",
            description: "Font size (px) for story text in the scene editor ({min}-{max}).",
        },
        editorFontFamily: {
            label: "Story editor font",
            description: "Typeface used for story text in the scene editor.",
        },
        editorSurfaceOpacity: {
            label: "Editor surface opacity",
            description: "Opacity of the surfaces behind story text and inspector fields.",
        },
        maxActiveEditors: {
            label: "Maximum active editors",
            description:
                "How many editor tabs stay loaded at once, keeping their scroll position and focus ({min}-{max}). The rest reload when reopened.",
        },
        blueprintDragConnectExecOutput: {
            label: "Drag from execution output pins to create nodes",
            description: "Drop on empty canvas to pick a node; it is wired in after that pin.",
        },
        blueprintDragConnectDataOutput: {
            label: "Drag from data output pins to create nodes",
            description: "Drop on empty canvas to pick a node; only nodes that accept that value type are listed.",
        },
        blueprintDragConnectInput: {
            label: "Drag from input pins to create nodes",
            description: "Drop on empty canvas to pick a node; its output is wired into that pin.",
        },
        slashAtAlias: {
            label: "Use “@” to open the action creator",
            description: "Avoids the clash between / and 、 in Chinese input methods.",
        },
        localizedCommands: {
            label: "Show story commands in the interface language",
            description:
                "Turn this off to keep the action creator's command names, parameter names and values in English. Their English spellings work either way.",
        },
        hideParamNames: {
            label: "Commands show only parameter values",
            description: "A more compact reading of the commands in a row.",
        },
        electronMirror: {
            label: "Electron download mirror",
            description: "Mirror for downloading Electron. Leave empty to use the official source.",
        },
        pluginRegistryUrl: {
            label: "Registry URL",
            description: "Where the plugin store looks. Leave empty to use the official NarraLeaf registry.",
        },
        uiTemplateRegistryUrl: {
            label: "UI template registry URL",
            description: "Where the template store looks. Leave empty to use the official NarraLeaf registry.",
        },
        checkpointInterval: {
            label: "Automatic checkpoint interval",
            description:
                "How long to wait before recording a checkpoint, and only when something changed. Set to 0 to turn them off.",
        },
        checkpointOnClose: {
            label: "Record a checkpoint when a workspace closes",
            description: "Records on closing the window, independent of the interval above.",
        },
        versionControlAuthor: {
            label: "Author name",
            description: "Recorded on commits and checkpoints. Leave empty to record NarraLeaf Studio instead.",
        },
        versionControlAuthorEmail: {
            label: "Author email",
            description: "Recorded next to the author name, as \"Name <email>\". Leave empty to record no address.",
        },
        confirmBeforeClose: {
            label: "Confirm before closing a workspace",
            description: "Ask for confirmation when you close a workspace window.",
        },
        returnToLauncherOnClose: {
            label: "Return to the home screen when closing a workspace",
            description: "Turn this off to quit NarraLeaf Studio instead when no other window is open.",
        },
        dashboardOnOpen: {
            label: "Show the project dashboard by default",
            description: "Applies to projects you haven't decided about. Each project can override it.",
        },
        clearAllStats: {
            label: "Clear all statistics data",
            description:
                "Erase the writing history, active time, and build history of every project. Counts read from your projects are unaffected.",
            action: "Clear",
            confirm: "Clear everything",
        },
        statusBarVisible: {
            label: "Show status bar",
            description: "The strip along the bottom of the workspace.",
        },
        titleBarSearchVisible: {
            label: "Show title bar search box",
            description: "The search box in the middle of the title bar.",
        },
        backgroundImage: {
            label: "Custom background image",
            description: "Show a picture of your choice behind the workspace.",
            action: "Configure…",
            needsWorkspace: "Open a workspace to configure the background image.",
        },
        keybindings: {
            label: "Keyboard shortcuts",
        },
    },
} as const;
