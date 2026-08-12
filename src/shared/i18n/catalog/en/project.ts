/** `project` - the Project settings sidebar: overview hub plus six slide-in sub-pages. */
export const project = {
    // A row names what is inside it. These were sentences about what each page was for, which read
    // as claims rather than contents and did not survive the merge: a page holding three parts
    // cannot be summed up in a claim, but it can list what it holds.
    nav: {
        app: {
            title: "App",
            description: "Name, version, icons, and plugins",
        },
        game: {
            title: "Game",
            description: "Saving, player defaults, and audio tracks",
        },
        // Named for the page, not for its one current part: the palette is what is here today, and
        // typography and the rest of a project's look are meant to join it.
        design: {
            title: "Design",
            description: "Colors, and the controls they paint",
        },
        project: {
            title: "Project",
            description: "Project check rules and what stops a build",
        },
        runtimes: {
            title: "Runtimes",
            description: "Live2D and Spine drawing runtimes",
        },
        settings: {
            title: "Settings",
            description: "Security, signing, optimization, and mobile",
        },
    },
    // The headings that tell one part of a sub-page from the next. A heading is a noun, never a
    // sentence: the rows under it say what they do.
    group: {
        details: "Details",
        appTags: "Build variants",
        userData: "Player files",
        icons: "Icons",
        dependencies: "Dependencies",
        saving: "Saving",
        playerDefaults: "Player defaults",
        audioTracks: "Audio tracks",
        // The two parts of the Brand sub-page. The colors an author decides, and the slots that
        // follow them; the rest of that page's words are in the `brand` namespace, beside the model
        // whose ids they name.
        brandColors: "Colors",
        brandControls: "Controls",
        security: "Security",
        signing: "Signing",
        optimization: "Optimization",
        mobile: "Mobile",
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
        // Shown in the packaged app's file properties and About box. Editable here rather than only
        // in the build dialog, which now reads it back instead of asking for it.
        copyrightLabel: "Copyright",
        copyrightPlaceholder: "© Your Studio",
        // The long form, kept apart from the line above because they reach different readers: one
        // line goes into the binary's file properties, this goes into a file players can open.
        copyrightTextLabel: "Copyright Notice",
        copyrightTextPlaceholder: "Fonts, music and assets used, and who they belong to…",
        copyrightTextHelper: "Shipped beside the game as COPYRIGHT.txt. Left empty, no file is shipped.",
        descriptionPlaceholder: "Describe your project…",
        required: "Required",
    },
    // Where a shipped game writes what belongs to the player. Stated, not offered: nothing on this
    // part is a setting, and it names no storefront, because which of them to hand this to is the
    // author's decision. The description says what the paths are, and stops there.
    userData: {
        description: "Where a shipped game keeps the player's saves and progress. The folder is named "
            + "after the identifier, so renaming the application leaves it where it is.",
        copy: "Copy locations",
        copied: "Locations copied.",
        copyFailed: "Could not copy the locations.",
        platform: {
            windows: "Windows",
            macos: "macOS",
            linux: "Linux",
        },
        content: {
            saves: "Save slots",
            persistence: "Persistent variables, unlocked content, and plugin data",
        },
    },
    // Build variants: the editions the same project ships as. What a variant is and what inheriting
    // means live in the `appTags` help topic, reached by the `?` on this heading; the words here name
    // controls and say what pressing one does.
    appTags: {
        add: "Add variant",
        newTagName: "New Variant",
        nameTitle: "Name",
        fields: {
            displayName: "Application name",
            identifier: "Identifier",
            version: "Version",
        },
        // Sits beside a field only while that field states a value of its own, so it is the mark of
        // an override as well as the way out of one.
        restore: "Restore",
        // Heading for the scene lists, shown only where the project holds something that can start a
        // scene the build cannot read. Each list below it is labelled with that thing's own name.
        reachableTitle: "Scenes these can start",
        // Beside Delete inside an open variant: the count the confirmation is about to be about.
        usedBy: {
            one: "Used by {count} reference",
            other: "Used by {count} references",
        },
        delete: "Delete",
        deleteConfirm: "Delete \"{name}\"?",
        // The honest consequence: nothing pointing at this variant is rewritten, so those references
        // read the release values from now on. `{name}` is the release variant's name, interpolated
        // rather than written here so this line follows it if it is ever renamed.
        deleteDetail: {
            one: "{count} reference falls back to {name}.",
            other: "{count} references fall back to {name}.",
        },
        // The second half of that consequence, for the references that are rows in the script: a cut
        // point is kept, and one that names no variant ends nothing.
        deleteDetailCuts: {
            one: "{count} cut point stays in the script and stops taking effect.",
            other: "{count} cut points stay in the script and stop taking effect.",
        },
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
        autoSaveDescription: "Save the playthrough on a timer, so a crash loses at most one interval.",
        autoSaveIntervalTitle: "Save every",
        autoSaveIntervalDescription: "How often to check. Nothing is written unless the story advanced.",
        autoSaveIntervalUnit: "s",
        autoSaveSlotsTitle: "Autosaves kept",
        autoSaveSlotsDescription: "Autosaves rotate through this many slots, oldest first. They are separate from the player's own save slots.",
    },
    // The Player defaults group: the value each player setting starts at. Every one of these is
    // still the player's to change while they play, and what they change is kept, so the wording
    // stays on "starts at" rather than promising anything the settings screen will not honour.
    preferences: {
        // One line on the group heading, not a paragraph in the page. Everything else it used to
        // say is either visible in the rows or of no use to the author reading them.
        intro: "The starting value of each setting for a player who has not changed it. Players can change all of them, and their choices are kept.",
        group: {
            dialogue: "Dialogue",
            skipping: "Skipping",
            // Not "Audio": the mixer sits on the same page now, and two headings called Audio one
            // scroll apart is exactly the confusion the merge was meant to remove.
            audio: "Sound",
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
            description: "When off, the game starts with the dialogue box hidden, in the state the player's hide-UI toggle produces.",
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
            description: "What happens to the clip when its line ends. Two voice clips never play at once, whichever option is selected.",
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
        // What a bus is and how the mix multiplies now lives in the `audio` help topic, reached by
        // the `?` in this section's header. It was a paragraph here, and before that the same
        // paragraph on every field of every track.
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
        allowHttpWebHint: "Not enforced in the Web export, which is itself served over HTTP. Network nodes still run there.",
        encryptAssetsTitle: "Encrypt assets",
        encryptAssetsDescription: "Encrypt assets, plugin code and the story bundle in packaged and previewed builds. Does not affect Dev Mode.",
        encryptAssetsWebHint: "Not applicable to the Web export: Web builds always ship without asset protection.",
        // The whole Signing group in one line. Every signable platform gets a row, whether or not this
        // machine can build it: a certificate is obtained days before the build that uses it, and
        // preparing one is why this sits in the panel rather than in the build dialog.
        signingDescription: "Which credential signs each platform. Certificates and passwords stay on this machine; the project stores only which one to use.",
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
        // Not "Mobile orientation": it sits under the Mobile heading, and the repeated word cost the
        // label a second line in a 318px panel.
        orientationTitle: "Orientation",
        orientationDescription: "The orientation mobile builds lock the game to when it starts.",
        orientation: {
            landscape: "Landscape",
            portrait: "Portrait",
            auto: "Follow device",
        },
        stageFitTitle: "Screen fit",
        /**
         * Where it applies, not what it does — the title and the two option labels already say
         * that, and this column is ~200px wide, where a long sentence wraps one word per line.
         */
        stageFitDescription: "Mobile builds and Dev Mode. Desktop and web always letterbox.",
        stageFit: {
            contain: "Letterbox",
            cover: "Fill and crop",
        },
        /** Named for what survives, not for what goes: an author decides what to keep. */
        cropAnchorYTitle: "Keep vertically",
        cropAnchorYDescription: "Kept when the screen is wider than the stage.",
        cropAnchorY: {
            top: "Top",
            center: "Center",
            bottom: "Bottom",
        },
        cropAnchorXTitle: "Keep horizontally",
        cropAnchorXDescription: "Kept when the screen is narrower than the stage.",
        cropAnchorX: {
            left: "Left",
            center: "Center",
            right: "Right",
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
