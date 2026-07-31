/** `project` - the Project settings sidebar: overview hub plus slide-in sub-pages (details, assets, dependencies, settings). */
export const project = {
    nav: {
        details: {
            title: "Details",
            description: "Name, identifier, and metadata",
        },
        game: {
            title: "Game",
            description: "How the finished game behaves for players",
        },
        assets: {
            title: "Assets",
            description: "Application icons for each platform",
        },
        dependencies: {
            title: "Dependencies",
            description: "Plugins this project relies on",
        },
        runtimes: {
            title: "Runtimes",
            description: "Drawing runtimes for Live2D and Spine characters",
        },
        linting: {
            title: "Linting",
            description: "Which problems the project check reports",
        },
        settings: {
            title: "Settings",
            description: "Networking and packaging behavior",
        },
    },
    home: {
        untitledProject: "Untitled project",
    },
    subPage: {
        backAria: "Back to project overview",
    },
    details: {
        nameLabel: "Application Name",
        namePlaceholder: "Application name",
        nameRequired: "Application name is required.",
        identifierLabel: "Identifier",
        identifierHelper: "Set when the project was created and used for packaging.",
        versionLabel: "Version",
        authorLabel: "Author",
        authorPlaceholder: "Author, organization, or email",
        websiteLabel: "Website",
        descriptionPlaceholder: "Describe your project…",
        required: "Required",
    },
    assets: {
        master: "Choose the app icon",
        override: "Override",
        chooseOverride: "Choose an image for this platform",
        clearOverride: "Use the app icon here",
        inset: "Inset",
        background: "Background",
        clearBackground: "Keep transparency",
        transparent: "None",
        icnsPreview: "ICNS preview",
        target: {
            macos: "macOS",
            windows: "Windows",
            linux: "Linux",
            android: "Android",
            ios: "iOS",
            web: "Web",
        },
    },
    game: {
        autoSaveTitle: "Automatic saving",
        autoSaveDescription: "Save the playthrough on a timer while the player is in the game, so a crash or a closed window costs a moment instead of a session.",
        autoSaveIntervalTitle: "Save every",
        autoSaveIntervalDescription: "How often to check. Nothing is written unless the story moved on, so an idle game costs nothing.",
        autoSaveIntervalUnit: "s",
        autoSaveSlotsTitle: "Autosaves kept",
        autoSaveSlotsDescription: "Autosaves rotate through this many slots, oldest overwritten first. They stay out of the player's own save slots and are read with the List Auto Saves node.",
    },
    settings: {
        allowHttpTitle: "Allow HTTP",
        allowHttpDescription: "When off, the game is confined to the app protocol and all HTTP/HTTPS requests are blocked.",
        allowHttpWebHint: "Not applicable to the Web export: a web game is served over HTTP(S) by nature, so this setting only affects desktop builds.",
        encryptAssetsTitle: "Encrypt assets",
        encryptAssetsDescription: "Encrypt assets, plugin code and the story bundle in packaged and previewed builds. Makes unpacking difficult; does not affect Dev Mode.",
        encryptAssetsWebHint: "Not applicable to the Web export: Web builds always ship without asset protection.",
        orientationTitle: "Mobile orientation",
        orientationDescription: "The orientation mobile builds lock the game to when it starts.",
        orientation: {
            landscape: "Landscape",
            portrait: "Portrait",
            auto: "Follow device",
        },
    },
    dependencies: {
        rescan: "Rescan",
        scanning: "Scanning project…",
        empty: "No plugin dependencies. This project uses only built-in Studio features.",
        banner: {
            blocked: "One or more plugins are disabled for this project because their installed version is incompatible. Update or reinstall them to restore full functionality.",
            warnings: "Some dependencies need attention. A plugin is outdated or a soft dependency is unavailable.",
        },
        status: {
            ready: "Ready",
            outdated: "Outdated",
            missing: "Missing",
            incompatible: "Incompatible",
            disabled: "Disabled",
        },
        meta: {
            requires: "Requires {version}",
            installed: "Installed {version}",
            notInstalled: "not installed",
            builtIn: "Built-in",
            dataOnly: "data only",
        },
        usage: {
            blueprintNode: {
                one: "{count} node",
                other: "{count} nodes",
            },
            widget: {
                one: "{count} widget",
                other: "{count} widgets",
            },
            storage: {
                one: "{count} store",
                other: "{count} stores",
            },
            storyAction: {
                one: "{count} action",
                other: "{count} actions",
            },
        },
    },
} as const;
