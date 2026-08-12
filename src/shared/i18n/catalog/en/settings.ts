/** `settings` - the Settings window (registry-driven; see appSettings.ts). */
export const settings = {
    title: "Settings",
    searchPlaceholder: "Search settings…",
    loading: "Loading settings…",
    noResults: "No settings match the search.",
    empty: "No settings available.",
    noneExposed: "No settings are exposed in this section.",
    invalidValue: "Please provide a valid value",
    persistFailed: "Failed to persist setting",
    resetToDefault: "Reset to default",
    customColor: "Custom color…",
    // The font chooser (SettingFontPicker): presets plus whatever is installed on this computer.
    fontPicker: {
        searchPlaceholder: "Search fonts…",
        presets: "Presets",
        installed: "Fonts on this computer",
        // Each row is set in its own face, so this is the specimen for a family whose NAME says
        // nothing about it — most CJK families are named in Latin.
        sample: "AaBb 字体",
        noMatches: "No fonts match your search.",
        loading: "Reading the fonts installed on this computer…",
        unavailable: "This build cannot list installed fonts. The presets above still work.",
        denied: "Studio could not read the installed fonts. Bring this window to the front and reopen the list.",
        failed: "Could not read installed fonts: {message}",
        notInstalled: "not installed",
    },
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
        shortcuts: {
            label: "Shortcuts",
            description: "Keys bound to each command throughout Studio.",
        },
        versionControl: {
            label: "Version control",
            description: "Checkpoints and the identity recorded on them.",
        },
        network: {
            label: "Network",
            description: "Where Studio downloads plugins, templates and build tooling from.",
        },
        data: {
            label: "Data",
            description: "Cached files, resetting preferences, and moving them between machines.",
        },
    },
    // Individual settings - keyed by the setting they localize.
    items: {
        language: {
            label: "Language",
            description: "Display language for the Studio interface.",
        },
        developerMode: {
            label: "Developer options",
            description: "Right-click menus gain a section for copying the ID of the item clicked.",
        },
        confirmQuit: {
            label: "Confirm before quitting with ⌘Q",
            description: "⌘Q quits once it has been held down. A short press does nothing.",
            unsupportedPlatform: "Not available on this operating system.",
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
            description: "Turn off animated transitions in the Studio interface. The game's own animations are unaffected.",
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
            description: "Typeface used for story text in the scene editor. Any font installed on this computer can be chosen.",
            // Keys are camelCase; the stored ids they map to are the display strings in
            // editorFontOptions.ts, which older global.json files already hold.
            options: {
                default: "Default",
                sansSerif: "Sans serif",
                serif: "Serif",
                monospace: "Monospace",
            },
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
        storyRowHighlight: {
            label: "Highlight story rows",
            description: "Give one kind of row a background tint, so it separates from the rest.",
            options: {
                none: "No highlight",
                script: "Highlight spoken lines",
                command: "Highlight commands",
            },
        },
        detachedEditorOnClose: {
            label: "When a detached editor window closes",
            description: "An editor opened in its own window either returns to the workspace or closes with the window.",
            options: {
                restoreTab: "Return it to the workspace",
                close: "Close the editor",
            },
        },
        editorLineNumbers: {
            label: "Show line numbers",
            description: "In the built-in text editor, for files opened from the asset library.",
        },
        editorSoftWrap: {
            label: "Wrap long lines",
            description: "Wrap instead of scrolling sideways in the built-in text editor.",
        },
        recentProjectsLimit: {
            label: "Recent projects to remember",
            description: "How many projects the home screen and the Open Recent menu keep.",
        },
        electronMirror: {
            label: "Electron download mirror",
            description: "Mirror for downloading Electron. Leave empty to use the official source.",
        },
        electronBuilderBinariesMirror: {
            label: "Build tooling mirror",
            description:
                "Mirror for the installer tooling a build downloads (NSIS, AppImage, code-signing helpers). Leave empty to use the official source.",
        },
        downloadRewrites: {
            label: "Download address rewrites",
        },
        pluginRegistryUrl: {
            label: "Plugin registry URL",
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
            description: "Applies to projects with no setting of their own. Each project can override it.",
        },
        clearAllStats: {
            label: "Clear all statistics data",
            description:
                "Erase the writing history, active time, and build history of every project. Counts read from the projects are unaffected.",
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
            description: "Show an image behind the workspace.",
            action: "Configure…",
            needsWorkspace: "Open a workspace to configure the background image.",
        },
        keybindings: {
            label: "Keyboard shortcuts",
        },
        cacheInventory: {
            label: "Cached files",
        },
        settingsTransfer: {
            label: "Move settings between machines",
        },
        resetWorkspaceLayout: {
            label: "Reset the workspace layout",
            description:
                "Return the panels, sidebars and open editor tabs to their initial state. Projects are not modified.",
            action: "Reset",
            confirm: "Reset the layout",
        },
        resetAllPreferences: {
            label: "Reset all settings",
            description:
                "Return every setting to its default. Projects, their history and the statistics are not modified.",
            action: "Reset",
            confirm: "Reset everything",
        },
    },
    // The Data panel's own chrome.
    data: {
        cache: {
            measuring: "Measuring…",
            unavailable: "Not available",
            clear: "Clear",
            clearAll: "Clear all",
            refresh: "Measure again",
            freed: "Freed {size}.",
            buckets: {
                electronBuilder: {
                    label: "Game build tooling",
                    description: "Electron and the installer tools downloaded for a build.",
                },
                buildDependencies: {
                    label: "Plugin build files",
                    description: "Archives that plugins download to include in a built game.",
                },
                browser: {
                    label: "Interface cache",
                    description: "Interface state kept between runs to speed up startup.",
                },
                pluginIcons: {
                    label: "Plugin store thumbnails",
                    description: "Downloaded again the next time you open the store.",
                },
                uiTemplatePosters: {
                    label: "Template store posters",
                    description: "Downloaded again the next time you open the store.",
                },
                psdImports: {
                    label: "PSD import leftovers",
                    description: "Layer images written while importing a PSD.",
                },
                logs: {
                    label: "Logs",
                    description: "What an exported diagnostics file is built from.",
                },
            },
        },
    },
    transfer: {
        export: "Export…",
        import: "Import…",
        apply: "Apply",
        exportHint: "Writes the settings to a plain JSON file. The workspace background, the name recorded on commits, recent projects, statistics and window layout stay on this machine.",
        exported: "Saved to {path}",
        imported: "Applied {count} settings.",
        exportFailed: "The settings could not be saved.",
        importFailed: "The file could not be read.",
        planSummary: "{change} to change, {same} already the same, {skipped} skipped.",
        skippedUnknown: "{key}: this version of Studio has no such setting",
        skippedInvalid: "{key}: {reason}",
    },
    // The Network panel's own chrome, outside the per-setting labels above.
    network: {
        test: "Test",
        probing: "Checking…",
        probeAnswered: "The address answered with {status}.",
        probeNoAnswer: "No answer: {error}",
        probeFailed: "The check could not be run.",
        rewrites: {
            hint: "Some downloads use an address that comes from a catalogue rather than from the settings above, such as a plugin's package file. A rule here replaces the beginning of those addresses.",
            empty: "No rewrites. Downloads use the addresses they come with.",
            add: "Add a rule",
            remove: "Remove this rule",
            enabled: "Use this rule",
            fromPlaceholder: "https://github.com/",
            toPlaceholder: "https://your-mirror.example/gh/",
        },
    },
} as const;
