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
        servers: {
            label: "Servers",
            description: "Servers this installation is signed in to, and the accounts it uses.",
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
            description: "⌘Q quits when it is pressed twice in a row. A single press does nothing.",
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
        tooltipDelay: {
            label: "Tooltip delay",
            description: "How long the pointer rests on a control before its tooltip appears. Within a toolbar the wait applies to the first tooltip only.",
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
        spellcheckLanguage: {
            label: "Spellcheck language",
            description: "Marks misspellings in the story script. Translations are never checked.",
            /**
             * Shown in place of the description while the project's own language has no dictionary.
             * A statement of what is true, not an error: Chinese and Japanese have no spelling in
             * the hunspell sense, so there is nothing for Chromium to check and never will be.
             */
            noDictionary: "There is no spelling dictionary for this project's language, so nothing in the script is marked. The project dictionary still holds the project's own terms.",
            options: {
                followProject: "Follow the project's language",
                off: "Do not check spelling",
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
            // Replaces the description above while the field is closed, so the row says why
            // rather than merely refusing to be typed in. Shown on both author fields.
            fromServer:
                "Comes from the server this installation is signed in to. Sign out to record a name of your own again.",
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
        servers: {
            label: "Servers",
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
    /**
     * Servers this installation is signed in to.
     *
     * A server is added here and nowhere else. The words avoid "log in" and "account
     * details": what is pasted is a token somebody issued, and the panel says so once
     * rather than explaining it beside every field.
     */
    servers: {
        empty: "No servers have been added.",
        openAdd: "Add a server",
        add: "Add",
        adding: "Adding…",
        cancel: "Cancel",
        continue: "Continue",
        checking: "Checking…",
        done: "Done",
        signOut: "Sign out",
        // The one thing an author is handed. Every other address is behind it, including
        // the `lore://` remote, which is stored and never named to anybody.
        addressLabel: "Server address",
        addressPlaceholder: "nlteam://studio.example.lan:41402",
        reached: "{name} answered at {address}.",
        // "Access token" rather than "password": it is not one, and it cannot be chosen,
        // remembered or reset by the person pasting it.
        tokenLabel: "Access token",
        tokenPlaceholder: "Paste the access token",
        hint: "The access token is issued by the server's administrator.",
        // A server with nothing to sign in to. Said rather than hidden, because the
        // absence of an entry afterwards is otherwise indistinguishable from a failure.
        noAccount: "{name} does not require authentication, so there is nothing to add.",
        // What reaching an address came to, before anything has been added. Separate from
        // `problems`, which are refusals of a token by a server already reached.
        probe: {
            unreachable: "Nothing answered at that address.",
            notAServer: "Something answered at that address, and it is not a NarraLeaf Team server.",
            untrusted: "The server at that address was not trusted.",
            failed: "That address could not be checked.",
        },
        problems: {
            scheme: "A sign-in address has to start with https:// or ucs-auth://.",
            token: "That is not a token this server would have issued.",
            // Neither names a field any more: both addresses come from the server's own
            // answer, so there is nothing here for a reader to correct.
            address: "This token does not say where to sign in.",
            server: "This token does not say which server it is for.",
            certificate: "This machine does not trust the certificate presented at that address.",
            unreachable: "Nothing answered at that address.",
            refused: "The server refused this token. It may have expired or been revoked.",
            unknown: "The server could not be added.",
        },
    },
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
