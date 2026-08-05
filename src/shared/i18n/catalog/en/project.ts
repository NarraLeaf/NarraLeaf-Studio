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
        preferences: {
            title: "Preferences",
            description: "What a new player's settings start at",
        },
        audio: {
            title: "Audio",
            description: "The mixer: which bus feeds which, and how loud each one is",
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
        autoSaveDescription: "Save the playthrough on a timer, so a crash costs a moment instead of a session.",
        autoSaveIntervalTitle: "Save every",
        autoSaveIntervalDescription: "How often to check. Nothing is written unless the story moved on.",
        autoSaveIntervalUnit: "s",
        autoSaveSlotsTitle: "Autosaves kept",
        autoSaveSlotsDescription: "Autosaves rotate through this many slots, oldest first. They stay out of the player's own save slots.",
    },
    // The Preferences sub-page: the value each player setting starts at. Every one of these is
    // still the player's to change while they play, and what they change is kept, so the wording
    // stays on "starts at" rather than promising anything the settings screen will not honour.
    preferences: {
        intro: "The value each setting starts at for a player who has not changed it. All of them stay editable while the game runs, and whatever the player settles on is kept between sessions.",
        group: {
            dialogue: "Dialogue",
            skipping: "Skipping",
            audio: "Audio",
        },
        unit: {
            percent: "%",
            ms: "ms",
            cps: "cps",
        },
        cps: {
            title: "Text speed",
            description: "Characters typed per second.",
        },
        gameSpeed: {
            title: "Game speed",
            description: "Scales both the typing speed and the auto-forward wait.",
        },
        autoForward: {
            title: "Auto forward",
            description: "Move on by itself once a line has finished displaying.",
        },
        showDialog: {
            title: "Show the dialogue box",
            description: "Off starts the game with the box hidden, as the player's hide-UI toggle leaves it.",
        },
        skip: {
            title: "Allow skipping",
            description: "Off disables the skip key outright.",
        },
        skipReadText: {
            title: "Skip read text only",
            description: "Skipping stops when it reaches a line the player has not read yet.",
        },
        skipDelay: {
            title: "Skip delay",
            description: "How long the skip key is held before continuous skipping starts.",
        },
        skipInterval: {
            title: "Skip interval",
            description: "Time between lines while skipping. Higher is slower.",
        },
        globalVolume: {
            title: "Master volume",
            description: "Everything the game plays.",
        },
        bgmVolume: {
            title: "Music volume",
            description: "The Music bus.",
        },
        soundVolume: {
            title: "SFX volume",
            description: "The SFX bus.",
        },
        voiceVolume: {
            title: "Voice volume",
            description: "The Voice bus.",
        },
        voiceEndMode: {
            title: "When a voiced line ends",
            description: "What happens to the clip when its sentence is done.",
            option: {
                stop: "Stop the clip",
                fade: "Fade the clip out",
                none: "Let it play on",
            },
        },
        voiceFadeDuration: {
            title: "Voice fade",
            description: "How long the fade lasts. Only used when the clip fades out.",
        },
    },
    // The Audio sub-page: the project's mixer, as a tree of buses. One collapsed row per bus with
    // its fields behind a disclosure, so the labels below are labels rather than headings - the
    // explanation they used to each carry is stated once, in `intro`. A paragraph repeated on every
    // track is noise; the same paragraph once is documentation.
    audio: {
        // What a bus is and how the mix multiplies, said once at the top of the section. This
        // absorbed the former per-field `nameDescription` / `parentDescription` / `volumeDescription`.
        intro: "A track is a bus: it feeds another bus, or the master output. A clip plays at its own level times every bus above it, and a bus can only quieten. Renaming is safe.",
        add: "Add track",
        newTrackName: "New Track",
        nameTitle: "Name",
        parentTitle: "Routes into",
        parentMaster: "Master output",
        volumeTitle: "Volume",
        volumeUnit: "%",
        loopTitle: "Loop by default",
        loopDescription: "Clips played on this track repeat unless the action that plays them says otherwise.",
        duplicate: "Duplicate",
        delete: "Delete",
        // Sits beside Delete inside an open bus: the count the confirmation is about to be about.
        usedBy: {
            one: "Used by {count} reference",
            other: "Used by {count} references",
        },
        deleteConfirm: "Delete \"{name}\"?",
        // The honest consequence: nothing pointing at this track is rewritten, so those references
        // resolve to the seeded bus for their own shape from now on - which one depends on what is
        // playing, so naming a single track here would be a guess.
        deleteDetail: {
            one: "{count} reference falls back to its default bus.",
            other: "{count} references fall back to their default bus.",
        },
        // Children are promoted rather than deleted, and the author is told where they land.
        deleteChildren: {
            one: "{count} track under it moves to {parent}.",
            other: "{count} tracks under it move to {parent}.",
        },
        // The player's own volume sliders, which alias onto the three seeded buses.
        slider: {
            bgm: "BGM Volume",
            sound: "Sound Volume",
            voice: "Voice Volume",
            // A bus hanging off master through none of the three has no alias of its own, so the
            // only player control over it is the one that governs everything.
            global: "Global Volume",
        },
    },
    settings: {
        allowHttpTitle: "Allow HTTP",
        allowHttpDescription: "When off, the game is confined to the app protocol and all HTTP/HTTPS requests are blocked.",
        allowHttpWebHint: "Does not apply to the Web export, only to desktop builds.",
        encryptAssetsTitle: "Encrypt assets",
        encryptAssetsDescription: "Encrypt assets, plugin code and the story bundle in packaged and previewed builds. Does not affect Dev Mode.",
        encryptAssetsWebHint: "Not applicable to the Web export: Web builds always ship without asset protection.",
        webLosslessImagesTitle: "Convert images to WebP",
        webLosslessImagesDescription: "Re-encode exported images as lossless WebP where that is smaller.",
        webLosslessImagesHint: "Each conversion is compared with the original pixel by pixel and discarded unless it decodes identically. Android and iOS builds serve the same exported site, so this applies to them too.",
        webPrecompressTitle: "Precompress text files",
        webPrecompressDescription: "Write Brotli and Gzip copies of the site's scripts, styles and story data.",
        webPrecompressHint: "Only a server set up to serve precompressed files uses them. Every other host serves the originals and ignores these.",
        webLossyImagesTitle: "Recompress images",
        webLossyImagesDescription: "Re-encode exported images as lossy WebP. Much smaller, and the lost detail cannot be recovered.",
        webLossyQualityTitle: "Image quality",
        webLossyQualityDescription: "WebP quality used when recompressing, from 1 to 100.",
        webSharedWithMobileHint: "Android and iOS builds serve the same exported site, so this applies to them too.",
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
            blocked: "Some plugins are disabled here: their installed version is incompatible. Update or reinstall them.",
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
