/** `assets` - the asset browser/manager: search, filters, grid/list views,
 * context menus, import controls, image/audio preview editors, and dialogs. */
export const assets = {
    loading: "Loading assets…",
    loadError: "Failed to load assets",
    searchPlaceholder: "Search assets…",
    searchTooltip: "Search assets",
    closeSearch: "Close search",
    clearSearch: "Clear search",
    backToParent: "Back to parent group",
    importRemote: "Import Remote",
    noTags: "No tags",
    preview: "Preview",
    unknownError: "Unknown error",
    delete: {
        inUseTitle: "These assets are still in use",
        inUseMessage: "Deleting them will leave the following places without a source:",
        moreReferences: "…and {count} more",
        unverifiedTitle: "Cannot check what uses these assets",
        unverifiedMessage:
            "The reference index could not be read, so nothing can say whether these are still in use. Delete them anyway?",
        confirmTitle: {
            one: "Delete {count} item?",
            other: "Delete {count} items?",
        },
        confirmMessage: "Everything inside a selected group is deleted too. This cannot be undone.",
        /** The delete button in the reference warning — danger-coloured, never the keyboard default. */
        action: "Delete",
        /** A delete the service refused after the author had already confirmed it. */
        failedTitle: "Failed to delete",
    },
    /**
     * Swapping the file behind an asset record. The record keeps its id, so every reference follows;
     * nothing here should suggest the author has to relink anything.
     */
    replace: {
        confirmTitle: "Replace the contents of {name}?",
        confirmAction: "Replace",
        failedTitle: "Failed to replace asset contents",
        remoteUnsupported: "Remote assets have no local file to replace.",
    },
    /** Per-type labels, keyed by the `AssetType` enum value. Used where a single type is named. */
    types: {
        image: "Images",
        audio: "Audio",
        video: "Videos",
        json: "JSON Files",
        blueprint: "Blueprints",
        font: "Fonts",
        model: "Models",
        other: "Other",
    },
    /** Sidebar section labels, keyed by the `AssetCategory` enum value. */
    categories: {
        image: "Images",
        media: "Media",
        data: "Data",
        font: "Fonts",
        model: "Models",
        other: "Other",
    },
    itemCount: {
        one: "{count} item",
        other: "{count} items",
    },
    /**
     * The read-only asset overview page. "Actual" and "If trimmed" are load-bearing: a build still
     * packages the whole assets directory, and nothing on this page changes that - so no string
     * here may read as though reference-based trimming were in effect, or as though the second
     * number were a forecast of what the next build will produce.
     */
    overview: {
        loading: "Reading the asset library…",
        failed: "Could not read the asset library.",
        retry: "Try again",
        section: {
            library: "Library",
            packaging: "Packaging",
            // The same six sections the sidebar draws, so the two halves of the panel reconcile.
            byCategory: "By category",
            largest: "Largest",
            unreferenced: "Unreferenced",
        },
        stat: {
            total: "Total",
            referenced: "Referenced",
            unreferenced: "Unreferenced",
            actual: "Actual",
            ifTrimmed: "If trimmed",
            difference: "Difference",
        },
        files: {
            one: "{count} file",
            other: "{count} files",
        },
        uses: {
            one: "{count} use",
            other: "{count} uses",
        },
        detail: {
            // The heading over the two addresses this editor invented for its own storage. It is a
            // noun, not a sentence: the rows under it are a hash and a path, and nothing captions them.
            storage: "Storage",
            path: "Path",
        },
    },
    view: {
        list: "List view",
        icons: "Icon view",
        overview: "Overview",
    },
    filter: {
        label: "Filters",
        // Headings for the filter groups. "Category" is the asset kind (image, audio); "Format" is
        // the file extension — two different questions that both used to read as "type".
        category: "Category",
        usage: "Usage",
        size: "Size",
        tags: "Tags",
        format: "Format",
    },
    actions: {
        copyTooltip: "Copy selected assets or groups",
        cutTooltip: "Cut selected assets or groups",
        pasteTooltip: "Paste assets or groups",
        deleteTooltip: "Delete selected assets or groups",
    },
    list: {
        emptyFiltered: "No assets matched the current filters.",
    },
    iconView: {
        updating: "Updating…",
        assetCount: {
            one: "{count} asset",
            other: "{count} assets",
        },
        tagCount: {
            one: "+{count} tag",
            other: "+{count} tags",
        },
    },
    import: {
        unableTitle: "Unable to import",
        failedTitle: "Failed to import assets",
        someFailedTitle: "Some assets failed to import",
        moveFailedTitle: "Failed to move imported asset",
        fileAccessFailed: "File access grant failed.",
        filePathParsingFailed: "File path parsing failed.",
        noMatchingFiles: "No matching files were found in the dropped folder.",
        moreFailures: "…and {count} more.",
        /** The import strip's failure list — files the run could not read, kept for a retry. */
        failedCount: {
            one: "{count} file failed",
            other: "{count} files failed",
        },
        retry: "Retry",
        remoteTitle: "Import Remote Asset",
        remoteDescription: "Paste a direct link to the remote asset",
        remoteInvalidUrl: "Please enter a valid URL",
        remoteFailedTitle: "Failed to import remote asset",
    },
    /**
     * The guided import for model bundles — the one asset type an author has a *folder* of rather
     * than files, and the one whose contents Studio can check before it copies them.
     *
     * Two things every string here has to keep straight. The kind picked on the first step decides
     * which manifests are looked for and nothing else: no runtime is installed, contacted or
     * required by anything this dialog does. And the checks are about **files being present**, not
     * about the model being good — nothing here may read as though Studio had validated a model.
     */
    modelImport: {
        title: "Import Models",
        familyStep: "What kind of model is this?",
        /** Said up front because the runtime installer is the step authors expect to be blocked by. */
        familyNoRuntime: "Nothing is installed here. The drawing runtime is set up later, on the character.",
        family: {
            live2d: "Live2D Cubism",
            live2dHint: "A folder holding a .model3.json, or Cubism 2's model.json.",
            spine: "Spine",
            spineHint: "A folder holding a .skel or .json skeleton beside its .atlas.",
        },
        folderStep: "Choose a folder",
        folderHint: "One model's folder, or a folder holding several. Everything inside is searched.",
        chooseFolder: "Choose Folder…",
        changeFolder: "Change…",
        rescan: "Scan again",
        scanning: "Scanning…",
        foundCount: {
            one: "{count} model found",
            other: "{count} models found",
        },
        noneFound: "No {family} models in this folder.",
        noneFoundHint: "Check the kind chosen above, then the folder. It should be the one the exporter wrote.",
        entry: "Entry",
        /** Row subtitle: what the folder holds, before any of it is copied. */
        fileSummary: "{count} files · {size}",
        selectAll: "Select all",
        selectNone: "Select none",
        importAction: "Import",
        importCount: {
            one: "Import {count} model",
            other: "Import {count} models",
        },
        /** Why a row starts unticked, and that ticking it anyway is allowed. */
        blockedHint: "Models with missing files start unticked. Tick one to import it as it is.",
        problemCount: {
            one: "{count} problem",
            other: "{count} problems",
        },
        problem: {
            missing: "Missing {role}: {path}",
            unusableReference: "The {role} “{raw}” is outside this folder and will not be copied with it.",
            manifestUnreadable: "{path} could not be read.",
            atlasMissing: "No atlas beside the skeleton; {path} was expected.",
            atlasEmpty: "{path} names no image.",
            nestedModel: "Holds another model, {path}, which this folder would bring along.",
        },
        /** How a missing file is named. Lower-case: these are read mid-sentence. */
        role: {
            moc: "model file",
            texture: "texture",
            physics: "physics file",
            pose: "pose file",
            displayInfo: "display info file",
            userData: "user data file",
            expression: "expression",
            motion: "motion",
            sound: "sound",
            skeleton: "skeleton",
            atlas: "atlas",
            page: "page image",
        },
        failedTitle: "Could not scan that folder",
        unreadable: "That folder could not be read.",
        /** Refused rather than truncated: a partial listing would report present files as missing. */
        tooManyFiles: "That folder holds {count} files, too many to check. Pick the folder the models are in.",
    },
    menu: {
        newGroup: "New Group",
        newSubGroup: "New Sub-Group",
        /** Other only: the one asset an author can make rather than import. */
        newTextFile: "New Text File",
        importAssets: "Import Assets…",
        replaceContent: "Replace File…",
        copyCount: {
            one: "Copy {count} item",
            other: "Copy {count} items",
        },
        cutCount: {
            one: "Cut {count} item",
            other: "Cut {count} items",
        },
        deleteCount: {
            one: "Delete {count} item",
            other: "Delete {count} items",
        },
    },
    selector: {
        selectType: "Select {type}",
        importFromDisk: "Import from disk",
        noAssets: "No assets match the current filters",
        selectedCount: "{count} selected",
        choose: "Choose",
    },
    cropper: {
        title: "Crop Image",
        reload: "Reload",
        loadError: "Unable to load image",
        selection: "Selection: {width}x{height}",
        waiting: "Waiting for selection…",
    },
    magicTag: {
        title: "Create Tags",
        detectedDelimiters: "Detected Delimiters",
        regexPattern: "Regular Expression Pattern",
        captureGroups: "Capture Groups: {groups}",
        categoryMapping: "Tag Category Mapping",
        exampleFilename: "Example Filename: {filename}",
        categoryPlaceholder: "Tag Category (e.g.: char, emo)",
        moreFiles: "… and {count} more files",
        summary: "Will add a total of {tags} tags to {files} files",
        applying: "Applying…",
        applyTags: "Apply Tags",
        parseFailedTitle: "Magic Tags parsing failed",
        applyFailedTitle: "Applying tags failed",
    },
    audio: {
        play: "Play",
        pause: "Pause",
        mute: "Mute",
        unmute: "Unmute",
        analyzing: "Analyzing waveform…",
        seek: "Seek",
        volume: "Volume",
        playback: "Playback",
        loading: "Loading audio…",
        loadError: "Failed to load audio",
        channelCount: {
            one: "{count} channel",
            other: "{count} channels",
        },
        // The preview's transport and view controls. Nothing here touches the audio file -
        // markers are the only thing written back, and they go to the asset record.
        editor: {
            toStart: "Go to start",
            loop: "Loop",
            zoomIn: "Zoom in",
            zoomOut: "Zoom out",
            zoomFit: "Fit whole clip",
            zoomSelection: "Zoom to selection",
            markIn: "Set in point at playhead",
            markLoop: "Set loop point at playhead",
            markOut: "Set out point at playhead",
            channels: "{count} ch",
        },
        // Shown in the keybinding settings table and the "?" cheat sheet.
        keybindings: {
            playPause: "Play or pause",
            toStart: "Go to start",
            toEnd: "Go to end",
            nudgeBack: "Nudge playhead back",
            nudgeForward: "Nudge playhead forward",
            nudgeBackCoarse: "Nudge playhead back one second",
            nudgeForwardCoarse: "Nudge playhead forward one second",
            loop: "Toggle loop",
            markIn: "Set in point",
            markLoop: "Set loop point",
            markOut: "Set out point",
            goToIn: "Go to in point",
            goToLoop: "Go to loop point",
            goToOut: "Go to out point",
            clearIn: "Clear in point",
            clearLoop: "Clear loop point",
            clearOut: "Clear out point",
            undo: "Undo marker change",
            redo: "Redo marker change",
            selectAll: "Select whole clip",
            clearSelection: "Clear selection",
            zoomIn: "Zoom in",
            zoomOut: "Zoom out",
            zoomFit: "Fit whole clip",
        },
    },
    image: {
        loading: "Loading image…",
        loadError: "Failed to load image",
        zoomIn: "Zoom In",
        zoomOut: "Zoom Out",
        resetView: "Reset View",
    },
    shortcuts: {
        copy: "Copy selected assets",
        cut: "Cut selected assets",
        paste: "Paste assets",
        rename: "Rename selected asset or group",
    },
    // Human-readable reasons an asset is locked against deletion (keyed by AssetLockReason).
    lockReason: {
        character: "Asset is used by a character",
        scene: "Asset is used by a scene",
        editor: "Asset is used by the Editor",
    },
    previewEditor: {
        loadFailed: "Failed to load this asset.",
    },
    fontPreview: {
        sampleText: "The quick brown fox jumps over the lazy dog - 敏捷的棕色狐狸跳过懒狗 0123456789",
        typePlaceholder: "Type to preview your own text…",
    },
    jsonPreview: {
        invalid: "This file is not valid JSON, showing raw content.",
        truncated: "File is too large to pretty-print, showing the beginning only.",
    },
    // The built-in Monaco text editor. It has no status bar of its own: the file name, encoding,
    // line ending and selection are cells in the WORKSPACE status bar, so most of what follows is
    // read by `modules/status-bar/textDocumentEntries` rather than by the tab.
    //
    // The value strings stay under `assets.textEditor` rather than moving to
    // `workspace.shell.statusBar` because they describe a text document, not the bar - the same
    // words would be needed if these ever appeared anywhere else.
    textEditor: {
        loadFailed: "Failed to read this file.",
        saveFailed: "Failed to save this file.",
        caret: "Ln {line}, Col {column}",
        // Appended to the caret read-out while something is selected, VS Code's wording. The
        // multi-range form exists because a bare character count under three cursors is a number
        // the author cannot attribute to anything they can see.
        selected: "({count} selected)",
        selectedInRanges: "({count} selected in {ranges} ranges)",
        selectionLabel: "Cursor position and selection",
        reopenWithEncoding: "Reopen with Encoding",
        saveWithEncoding: "Save with Encoding",
        selectEncoding: "Select the file's encoding",
        selectLineEnding: "Select the file's line ending",
        /** Screen-reader name for the status-bar line-ending cell, whose visible text is `LF`/`CRLF`. */
        lineEndingLabel: "Line ending: {ending}",
        /** Screen-reader name for the status-bar encoding token, whose visible text is the value alone. */
        encodingLabel: "Encoding: {encoding}",
        /**
         * Last resort when a plugin's text-editor action throws something with no message. The
         * plugin's own error text is preferred whenever it has one - it is the only thing that can
         * say which action failed and why.
         */
        actionFailed: "This action failed.",
    },
    /**
     * Creating a text file. The default name is a name, not a sentence: it lands in the input
     * already followed by `.txt`, and the author usually replaces the whole thing.
     */
    newTextFile: {
        title: "New Text File",
        prompt: "Name the file. Type an extension to keep it; without one, .txt is used.",
        placeholder: "notes.txt",
        defaultName: "New Text File",
        empty: "Please enter a file name",
        illegalChars: "A file name cannot contain \\ / : * ? \" < > |",
        failedTitle: "Failed to create the file",
    },
} as const;
