/**
 * `workspace` - the workspace window shell plus the game-localization panel.
 * The `localization` subtree is already translated; `shell` covers the window
 * chrome (toolbar, tabs, panels, common workspace dialogs).
 */
export const workspace = {
    localization: {
        panel: {
            languagesTitle: "Languages",
            languagesHint: "Languages of the game itself. The source language is the one the story is written in; the rest are translated against it.",
            addLanguage: "Add language",
            codePlaceholder: "Code (en, ja, zh-CN…)",
            namePlaceholder: "Display name",
            invalidCode: "Language codes may only contain letters, digits, and hyphens.",
            sourceBadge: "Source",
            more: "More",
            confirm: "Confirm",
            setSource: "Set as source language",
            removeLanguage: "Remove language",
            removeConfirm: "Remove {name}?",
            removeConfirmDetail: "Translations stay on disk and come back if the language is added again.",
            openTable: "Open translation table",
            progress: "{completed}/{total} translated",
            staleCount: "{count} to review",
            importSummary: "Imported {applied} translations ({unchanged} unchanged, {unknown} unknown, {skippedEmpty} empty skipped)",
        },
        settings: {
            menu: "Language settings…",
            title: "{name} language settings",
            displayNameLabel: "Display name",
            fallbackLabel: "Fallback language",
            fallbackHint: "An entry with no translation here uses this language, then the source language.",
            fallbackLoops: "leads back here",
        },
        exchange: {
            exportMenu: "Export translations…",
            importMenu: "Import translations…",
            importDialogTitle: "Select a translation file",
            exportTitle: "Export {name} translations",
            formatLabel: "Format",
            formatCsv: "CSV",
            formatCsvHint: "Excel, Google Sheets",
            formatXliff: "XLIFF 1.2",
            formatXliffHint: "Trados, memoQ, OmegaT",
            formatPo: "gettext PO",
            formatPoHint: "Poedit, Weblate, Crowdin",
            formatJson: "JSON",
            formatJsonHint: "Scripts and custom pipelines",
            scopeLabel: "Include",
            scopeAll: "Everything",
            scopePending: "Untranslated and to review",
            exportAction: "Export",
            exportDone: "Exported {count} lines to {path}",
            exportEmpty: "Nothing to export.",
            importFailed: "Could not read the file",
            importUnsupported: "Studio reads CSV, XLIFF, PO and JSON.",
            importNoRows: "No translation units in this file",
            importWarnings: "{count} entries were skipped. First: {first}",
            localeMismatch: "This file is for {declared}. Import it into {name}?",
            localeMismatchDetail: "The translations are imported into the selected language regardless of what the file declares.",
        },
        table: {
            storyLabel: "Source",
            sourceUi: "Interface text",
            sourceKeys: "Named keys",
            modeTranslate: "Translate",
            modeReview: "Review",
            filterAll: "All",
            filterUntranslated: "Untranslated",
            filterStale: "To review",
            filterCompleted: "Translated",
            reviewFilterReviewed: "Reviewed",
            reviewFilterUnreviewed: "Unreviewed",
            charactersGroup: "Characters",
            characterSpeaker: "Character",
            addKey: "Add",
            keyNamePlaceholder: "Key (menu.start…)",
            keySourcePlaceholder: "Source text",
            invalidKeyName: "Key names may contain letters, digits, and dots/underscores/hyphens between them.",
            removeKey: "Remove key",
            removeKeyConfirm: "Remove {name}?",
            removeKeyConfirmDetail: "Existing translations of this key stay in the language files.",
            sourceColumn: "Source",
            targetColumn: "Translation",
            targetPlaceholder: "Translate…",
            narrationSpeaker: "Narration",
            choiceSpeaker: "Choice",
            markReviewed: "Mark as reviewed",
            unmarkReviewed: "Back to translated",
            reviewApprove: "Approve",
            reviewReturn: "Return",
            reviewPendingCount: "{count} pending",
            reviewAllClear: "Nothing left to review.",
            staleHint: "The source line changed after this translation. Save it again to mark it current.",
            placeholderHint: "Keep the {n} placeholders. They render inline values.",
            emptyStory: "This story has no translatable lines yet.",
            emptyFilter: "Nothing matches this filter.",
            noStories: "Create a story first. Its lines appear here for translation.",
            statusUntranslated: "Untranslated",
            statusMachine: "Machine",
            statusTranslated: "Translated",
            statusReviewed: "Reviewed",
            statusStale: "To review",
        },
    },
    voice: {
        panel: {
            languagesTitle: "Voice languages",
            languagesHint: "Languages with voice-over. Independent of the text languages.",
            addLanguage: "Add voice language",
            codePlaceholder: "Code (ja, en, zh-CN…)",
            namePlaceholder: "Display name",
            invalidCode: "Language codes may only contain letters, digits, and hyphens.",
            more: "More",
            confirm: "Confirm",
            removeLanguage: "Remove voice language",
            removeConfirm: "Remove {name}?",
            removeConfirmDetail: "Voice assignments stay on disk and come back if the language is added again.",
            openTable: "Open voice table",
            progress: "{covered}/{total} voiced",
            staleCount: "{count} outdated",
            exportScript: "Export recording script",
            exportPickup: "Export pickup script (outdated only)",
            importAudio: "Import audio…",
            exportDone: "Exported to {path}",
            pickupEmpty: "No outdated lines to re-record.",
            importSummary: "Linked {linked} takes ({unmatched} unmatched, {failed} failed)",
            importFailed: "Could not import the audio files",
            importScript: "Import recording script…",
            importScriptSummary: "Applied {applied} rows ({unchanged} unchanged, {unknown} not voiced)",
            importScriptFailed: "Could not read that recording script",
            namingTitle: "Recording filename pattern",
            namingHint: "Tokens: {tokens}. Imported audio is matched to lines by this name.",
            namingReset: "Reset to default",
        },
        table: {
            storyLabel: "Story",
            groupByScene: "By scene",
            groupByCharacter: "By character",
            modeAssign: "Assign",
            modeAudition: "Audition",
            filterAll: "All",
            filterMissing: "Missing",
            filterOutdated: "Outdated",
            filterVoiced: "Voiced",
            filterApproved: "Approved",
            auditionFilterAll: "All",
            auditionFilterApproved: "Approved",
            auditionFilterPending: "Pending",
            narrationSpeaker: "Narration",
            narrationGroup: "Narration",
            castPlaceholder: "Voice actor…",
            assign: "Assign audio",
            replace: "Replace audio",
            remove: "Remove voice",
            play: "Play",
            stop: "Stop",
            approve: "Approve",
            reject: "Return",
            clipMissing: "Clip missing",
            outdatedHint: "The line changed after this take was imported. Import the clip again to mark it current.",
            noStories: "Create a story first. Its spoken lines appear here to voice.",
            emptyStory: "This story has no spoken lines yet.",
            emptyFilter: "Nothing matches this filter.",
            auditionAllClear: "Nothing left to audition.",
            auditionPendingCount: "{count} pending",
            statusMissing: "Missing",
            statusVoiced: "Voiced",
            statusApproved: "Approved",
            statusOutdated: "Outdated",
            notePlaceholder: "Note…",
            dropHint: "Drop audio to assign",
        },
    },
    // Recovery mode: the read-only, plugin-free way to reopen a workspace whose project will not
    // load, or loads wrong.
    recovery: {
        enter: "Open in recovery mode",
        enterFailed: "Could not open recovery mode: {error}",
        panelTitle: "Recovery",
        // The banner across the top of the window. Two facts and the way out; everything else about
        // the mode is in the panel, where there is room for it.
        banner: {
            state: "Recovery mode: read-only, no plugins loaded.",
            exit: "Leave recovery mode",
        },
        intro: "Running a check loads that part of the project and reports the result. Whatever loads can be browsed as usual.",
        problems: {
            title: "Problems found",
            count: "{count}",
            empty: "Nothing was reported while this window opened.",
            showRaw: "Original error",
            copy: "Copy this error",
            copied: "Copied.",
        },
        probes: {
            title: "Load checks",
            run: "Run",
            rerun: "Run again",
            runAll: "Run all",
            project: "Project manifest",
            assets: "Asset index",
            story: "Story outline",
            storyDocuments: "Story scripts",
            interface: "Interface documents",
            characters: "Characters",
            localization: "Localization",
            voice: "Voice-over",
            variables: "Persistent variables",
            audioTracks: "Audio tracks",
        },
        details: {
            noStories: "No stories in this project.",
            storiesRead: "{count} story documents read.",
        },
        tools: {
            title: "Tools",
            openFolder: "Open project folder",
            copyAll: "Copy everything",
            copiedAll: "Diagnostics copied.",
            openFolderFailed: "Could not open the project folder: {error}",
        },
        lore: {
            title: "Version history",
            loading: "Checking version control",
            unavailable: "Version control is unavailable: {reason}",
            notARepository: "this project has never been put under version control",
            noService: "version control did not start in this window",
            disabledHint: "This project has no version history to restore from.",
            head: "Now on version {version}, branch {branch}",
            emptyHistory: "No versions recorded yet.",
            noMessage: "(no message)",
            checkpoint: "Record a recovery point",
            checkpointDone: "Recorded as {revision}.",
            checkpointNothing: "Nothing to record: the current version already matches these files.",
            checkpointFailed: "Could not record a version: {error}",
            restore: "Restore this version",
            restoreConfirm: "Restore {version}?",
            restoreExplain: "Every file in the project is replaced with that version's contents. The current state is recorded as a version first, and the restore is added as another. No version is removed.",
            cancel: "Cancel",
            restoreDone: "Restored {version}. Reopening as a normal workspace.",
            restoreUnrecorded: "The files were restored, but the new version could not be recorded: {error}",
            restoreFailed: "Could not restore: {error}",
        },
        // Shown in a normal workspace when a read failed and the workspace carried on without it.
        // Says what tends to cause this and why editing now is risky; what recovery mode *is* can
        // wait until the author is in it.
        offer: {
            message: "This project did not load correctly",
            // Two wordings rather than "file(s)". The count is the first thing read and a bracketed
            // plural in a data-loss warning reads as a placeholder nobody finished.
            detailOne: "A file could not be read, so part of the project is missing from this window. Common causes: an interrupted save, a sync or backup tool writing at the same time, a plugin. Editing now can write this incomplete state over the files that are still intact.",
            detailMany: "{count} files could not be read, so part of the project is missing from this window. Common causes: an interrupted save, a sync or backup tool writing at the same time, a plugin. Editing now can write this incomplete state over the files that are still intact.",
            enter: "Open in recovery mode",
        },
        // Each key names what the workspace was doing, not what went wrong: the error itself is
        // shown verbatim underneath.
        operations: {
            enteredBecause: "The failure that led here",
            shellService: "Starting a recovery-mode service",
            preflight: "Checking the project folder",
            assetsShardCreate: "Creating the asset index",
            assetsShardRead: "Reading the asset index",
            storyIndexRead: "Reading the story outline",
            storyIndexParse: "Parsing the story outline",
            storyDocumentRead: "Reading a story script",
            storyDocumentParse: "Parsing a story script",
            interfaceDocumentRead: "Reading the interface documents",
            charactersRead: "Reading the characters",
            pluginLoad: "Loading a plugin",
            pluginHostLoad: "Loading plugins",
        },
    },
    // Undo/redo. `scope` names a stack ("undo in <this>"); `entry` names one step on it, which is
    // what a menu item or a toast says it is about to reverse.
    history: {
        scope: {
            storyScene: "scene",
            storyMotion: "motion",
            audioLoop: "audio markers",
            uiSurface: "interface",
            blueprint: "blueprint",
            project: "project",
        },
        menu: {
            undoNamed: "Undo {step}",
            redoNamed: "Redo {step}",
        },
        entry: {
            edit: "edit",
            storyEdit: "story edit",
            storyMotionEdit: "motion edit",
            audioMarkers: "marker change",
            surfaceEdit: "interface edit",
            blueprintEdit: "blueprint edit",
            replaceText: "text replacement",
        },
    },
    shell: {
        errorTitle: "Failed to initialize workspace",
        showStackTrace: "Show stack trace",
        retry: "Retry",
        openOtherProject: "Open another project",
        errorCopyDetails: "Copy details",
        errorCopied: "Error details copied to the clipboard.",
        errorCopyFailed: "Could not copy: {error}",
        errorExportLogs: "Export logs",
        errorExported: "Logs saved to {path}",
        errorExportFailed: "Could not export the logs: {error}",
        errorOpenFailed: "Could not open that folder: {error}",
        notAProjectTitle: "This folder is not a NarraLeaf project",
        notAProjectDetail: "No .nlproj file was found.",
        openLauncher: "Open launcher",
        panelRenderError: "This panel hit a rendering error",
        mainEditorRegion: "Main editor",
        resizeSplit: "Resize split",
        noActiveEditor: "No active editor",
        closePanel: "Close panel",
        closeTab: "Close {name}",
        newTab: "New tab",
        // Browser-style blank tab opened by the tab strip's "+".
        newTabPage: {
            title: "New Tab",
        },
        tabMenu: {
            close: "Close",
            closeOthers: "Close others",
            closeToRight: "Close tabs to the right",
            closeAll: "Close all",
            splitRight: "Split right",
            splitDown: "Split down",
            closeSplit: "Close split",
            reopenClosed: "Reopen closed tab",
        },
        toggleLeftSidebar: "Toggle left sidebar",
        toggleRightSidebar: "Toggle right sidebar",
        toggleBottomPanel: "Toggle bottom panel",
        // Right-click menu on a sidebar rail: a checklist toggling each panel icon's visibility,
        // plus shortcuts acting on the specific panel that was right-clicked.
        panelMenu: {
            removeItem: "Remove this item",
            collapseItem: "Collapse into group",
        },
        // The left rail's collapse group: one icon standing in for the panels folded behind it,
        // which unfolds into a flyout listing them.
        panelGroup: {
            title: "Collapsed panels",
        },
        openSettings: "Open settings",
        stopDevMode: "Stop Dev Mode",
        stopPreview: "Stop Preview",
        logoAlt: "NarraLeaf Studio logo",
        editorTabsLabel: "Editor tabs",
        // The searchable command palette (Cmd/Ctrl+Shift+P): one list of every action, menu
        // command, and described shortcut, filtered as you type.
        commandPalette: {
            title: "Command Palette",
            placeholder: "Type a command…",
            empty: "No matching commands",
            // Empty-state hint row that switches the palette into command mode (inserts ">").
            goToCommands: "Show and Run Commands",
            // Category shown on the "open <panel>" navigation entries.
            categoryView: "View",
            // Category + titles for the editor-tab commands (act on the active tab).
            categoryEditor: "Editor",
            // Caption for commands that declare no category (browse mode groups by category).
            categoryOther: "Other",
            categoryGo: "Go",
            categoryStory: "Story",
            categoryRun: "Run",
            categoryProject: "Project",
            categoryPreferences: "Preferences",
            // Category for the version-control commands (freeze, and later: commit, history).
            categoryVersionControl: "Version Control",
            editor: {
                closeTab: "Close Tab",
                closeSelectedTabs: "Close Selected Tabs",
                closeOthers: "Close Other Tabs",
                closeToRight: "Close Tabs to the Right",
                closeAll: "Close All Tabs",
                splitRight: "Split Editor Right",
                splitDown: "Split Editor Down",
                closeOtherGroups: "Close Other Editor Groups",
            },
        },
        // Notification center (bell in the control bar; ring-buffered history of all toasts).
        notifications: {
            title: "Notifications",
            clearAll: "Clear",
            empty: "No messages yet",
        },
        // The custom background dialog (opened from Settings or the command palette).
        background: {
            command: "Set background image…",
            title: "Background Image",
            image: "Image",
            imagePlaceholder: "No image selected",
            browse: "Browse…",
            opacity: "Opacity",
            blur: "Blur",
            // Shown in place of the pixel readout at 0, where the filter is off entirely.
            blurOff: "Off",
            fillMode: "Fill",
            anchor: "Position",
            fill: {
                cover: "Scale to fill",
                contain: "Fit",
                tile: "Tile",
                center: "Center",
            },
            cancel: "Cancel",
            clear: "Clear and close",
            apply: "Done",
        },
        // Quick Open (mod+p): fuzzy picker over openable entities.
        quickOpen: {
            title: "Quick Open",
            placeholder: "Go to scene, character, surface, asset, blueprint…",
            empty: "Nothing matches",
            kinds: {
                scene: "Scene",
                character: "Character",
                uiSurface: "UI",
                asset: "Asset",
                blueprint: "Blueprint",
            },
        },
        // The bottom status strip. Signals only show while meaningful (running/ building/dirty).
        statusBar: {
            // Mode names for the unified run-status cell, which reads "<mode> | <phase>" and tints
            // the whole bar with the theme colour while any mode runs.
            devMode: "Dev Mode",
            preview: "Preview",
            production: "Production",
            // The phase after the divider. Not every phase applies to every mode.
            phase: {
                starting: "Starting…",
                preparing: "Preparing…",
                compiling: "Compiling…",
                launching: "Launching…",
                packaging: "Packaging…",
                running: "Running",
                reloading: "Reloading…",
                stopping: "Stopping…",
            },
            openConsole: "Open the console",
            unsavedChanges: "Unsaved changes",
            saveNow: "Save now",
            saving: "Saving…",
            saveFailed: "Save failed",
            retrySave: "Retry saving now",
            resetZoom: "Reset zoom to 100%",
            shortcuts: "Keyboard shortcuts",
            words: "{count} words",
            lines: "{count} lines",
            noStoryOpen: "No story open",
            openDashboard: "Open the project dashboard",
            openCurrentScene: "Open the current scene",
            // Names for the registered entries, shown only in the bar's right-click toggle menu -
            // the cells themselves are icon-first and label their own state.
            entries: {
                runStatus: "Run status",
                unsavedChanges: "Unsaved changes",
                wordCount: "Story stats",
                shortcuts: "Keyboard shortcuts",
                notifications: "Notifications",
                theme: "Theme switcher",
                zoom: "Zoom level",
                version: "Version",
                // The text-document cells. Named for what they report rather than for the editor
                // they come from, because that is what the author is deciding to hide.
                textFileName: "Text file name",
                textEncoding: "Text encoding",
                textLineEnding: "Line ending",
                textSelection: "Cursor position",
            },
        },
        // Save reporting: the sticky toast raised when a file cannot be written, and the lines the
        // "Storage" console channel carries. A failed write retries on a backoff that never gives
        // up, so the wording says "still trying" rather than "lost".
        save: {
            failedTitle: "Couldn't save {file}",
            failedDetailTransient: "Still retrying in the background. {error}",
            failedDetailPermanent: "Retrying will not help until this is fixed. {error}",
            retry: "Retry now",
            consoleFailed: "write failed ({code}, attempt {attempt}): {path} · {error}",
            consoleRecovered: "write succeeded: {path}",
            flushFailed: "could not flush {label}: {error}",
            // The read side: a document that is on disk but cannot be understood. The wording leads
            // with what did NOT happen, because the fear this raises is "has Studio eaten my work?".
            unreadableTitle: "Couldn't read {file}",
            unreadableDetail: "{reason} The file is unchanged. Nothing was written over it.",
            unreadableDetailQuarantined: "{reason} The file is unchanged. A copy of it is at {path}.",
            consoleUnreadable: "read failed ({kind}): {path} · {reason}",
            consoleQuarantined: "kept a copy of the unreadable file at {path}",
            // A write refused because the workspace is frozen. Not a failure: nothing is wrong, and
            // nothing will be retried. The wording has to say why, or it reads as a bug.
            frozenTitle: "Changes are not being saved",
            frozenDetailRevision: "Version {version} is open. Nothing is saved while a version is open.",
            frozenDetailManual: "The workspace is frozen. Unfreeze it to resume saving.",
            // A merge has no "unfreeze": the working tree holds two sides at once until the
            // merge is finished, so naming that is the only useful thing this can say.
            frozenDetailMerge: "A merge is unfinished. Finish it from the version panel to resume saving.",
            consoleFrozen: "write refused, workspace frozen ({reason}): {path}",
            // Names for the things that hold project data - used when a flush fails, and again when a
            // working-tree re-read cannot reach one of them.
            stores: {
                uiDocument: "interface document",
                uiGraph: "interface blueprints",
                story: "story",
                localization: "localization",
                voice: "voice library",
                variables: "variable registry",
                audioTracks: "audio tracks",
                appTags: "build variants",
                brand: "brand palette",
                characters: "characters",
                project: "project settings",
                assets: "asset library",
            },
        },
        // Re-reading the working tree: the bytes on disk stopped being what the editors show (leaving a
        // freeze, restoring a version). The author should normally see nothing at all - this only
        // speaks up when part of it could not be read back, because that is when a panel is stale.
        reload: {
            failedTitle: "The project was not fully reloaded",
            failedDetail: "These still show their previous contents: {stores}. Reopen the project to read them again.",
            console: "re-read the project from disk ({cause}): {count} of them",
            consoleFailed: "could not re-read {label}: {error}",
        },
        // Freezing the workspace: project data stops being written, editor state carries on. Named
        // for what the author gets ("stop saving"), not for the mechanism.
        freeze: {
            command: "Freeze Project (Stop Saving Changes)",
            release: "Unfreeze Project (Resume Saving Changes)",
            enteredTitle: "Project frozen",
            enteredDetail: "Project files are not written until the project is unfrozen.",
            leftTitle: "Project unfrozen",
            leftDetail: "Changes are being saved again.",
            // Hover text on every top-bar control the freeze switches off. Deliberately one string
            // for all of them: the author has to learn "this is what a frozen project looks like"
            // once, not read a different excuse on each button. The controls are disabled rather
            // than hidden precisely so there is something to hover.
            unavailable: "Unavailable while the project is frozen. Unfreeze the project to use it.",
        },
        // Browsing history in the real editors, until the version rail exists. "Previous" rather than
        // a picker on purpose: choosing a revision needs a list, the list is the rail, and a milestone
        // whose behaviour cannot be reached by a person cannot be accepted.
        revisionView: {
            showPrevious: "Show the Previous Revision (Read-Only)",
            // Named for the mode it leaves, not the place it lands: see docs/help-system.md §4.
            leave: "Stop Viewing History",
            loadingTitle: "Reading the previous revision…",
            loadingDetail: "The first read of a revision may fetch it from the remote.",
            shownTitle: "Showing revision {revision}",
            shownDetail: "The editors are read-only. The files on disk are not modified.",
            noneTitle: "There is no earlier revision",
            noneDetail: "This project has only one revision.",
            failedTitle: "Could not show that revision",
        },
        // The version control surfaces: the rail down the far left, the version section inside the
        // project switcher's menu, and the status-bar cell. All three name a VERSION and never a change
        // count - counting needs a scan, and a scan is not a pure read (docs/version-control.md §4.17).
        versionControl: {
            title: "Version",
            open: "Open the version rail",
            // Two labels for one button, because it does two things: while the workspace is frozen the
            // panel collapses to the 48px strip (which must stay - it is the way out), and at HEAD there
            // is no strip, so closing it leaves nothing behind. "Collapse" there would promise a column
            // the author would then not find.
            collapse: "Collapse the version rail",
            close: "Close the version rail",
            // Hover text on the collapsed rail, the widget and the status cell while a past revision is
            // on screen. `{version}` is the revision's own label, e.g. `#4`.
            viewingVersion: "Viewing version {version}",
            currentVersion: "Current version",
            // The escape hatch, and the reason it appears in both rail states: a frozen workspace the
            // author cannot get out of is the worst thing this feature can do to them.
            //
            // It is named for the mode it LEAVES (docs/help-system.md §4). "Return to the current
            // version" described what happens to the repository, and read - beside a button that
            // really does overwrite the project, under a counter-clockwise arrow - as "put my
            // project back". This one cannot: viewing is the only thing it stops.
            returnToCurrent: "Stop viewing history",
            returning: "Leaving the history view…",
            // The one action in this whole surface that changes the author's files, and the three
            // lines below are the only thing standing between them and that happening.
            //
            // The action names itself rather than saying "restore": the confirm dialog puts this
            // string on the button, and a button reading "OK" beside a sentence about overwriting
            // files is how someone confirms the wrong thing.
            restore: "Restore this version",
            // Names the version so the dialog cannot be mistaken for one about a different one -
            // the author reached it from a list of them. `{version}` is `#12`, or a short hash for
            // a revision entered from somewhere that carried no label.
            restoreConfirm: "Restore version {version}?",
            // Two sentences, and neither is optional. The first is what the author is agreeing to;
            // the second is why agreeing is safe, and leaving it out would present a recoverable
            // operation as an irreversible one - after which nobody uses it. "Recorded first" is
            // literal: the checkpoint is committed before a single byte is written, and a
            // checkpoint that cannot be taken cancels the whole thing.
            restoreConfirmDetail:
                "The project files are replaced with this version's contents. "
                + "The current state is recorded as a checkpoint first, and no version is deleted.",
            // Long: a checkpoint, a rewrite of every versioned file, a second version, and then the
            // same full re-read as returning to the current version.
            restoring: "Restoring this version…",
            // The one restore failure that happens with the author's files ALREADY replaced: the
            // rewrite finished and only the commit recording it did not. It leads with what is true
            // of their project rather than with the error, because the assumption they would
            // otherwise make - "it failed, so nothing happened" - is the opposite of the truth, and
            // they would carry on working on a project that quietly went back a week. `{action}` is
            // the Submit-a-version button, named from its own string so the sentence cannot come to
            // point at a control that no longer says that.
            restoreNotRecordedTitle: "The files were restored, but the version was not submitted",
            restoreNotRecordedDetail:
                "The project files now hold the contents of version {version}. Submitting that as a new "
                + "version failed ({error}). Press \"{action}\" to submit it.",
            // A project with no repository. Named for what is missing, not for the mechanism.
            //
            // Short because two of its three homes are narrow: the status-bar cell and the top-bar
            // widget both truncate, and the previous wording ("No version history") arrived on a
            // real app as "No version hist…", which says nothing at all. Its third home is the
            // rail, where the Enable button and `enableHint` sit directly beneath it and carry the
            // explanation - so the title only has to name the state, not describe it.
            //
            // Deliberately NOT interchangeable with `noHistory` below: this one says version
            // control is off for this project, that one says it is on and has recorded nothing.
            notVersioned: "Not versioned",
            enable: "Enable version control",
            // One line, because enabling writes into the author's project folder and takes an
            // exclusive lock on it - so it says what it will do before they press it.
            // "Keeps" rather than "Records": this line is about the history that will exist, not
            // about the act - and leaving the one surviving "record" in author-facing copy directly
            // under a button that now says "Submit a version" would read as two names for one thing.
            enableHint: "Keeps a version history inside this project's folder.",
            enabling: "Setting up version control…",
            // A repository that exists and holds nothing - which is NOT `notVersioned` above, and
            // the wording keeps them apart on purpose: "not versioned" is a project the feature was
            // never turned on for, "empty history" is one where it is on and has recorded nothing.
            // Short for the same reason: the narrow surfaces truncate.
            noHistory: "Empty history",
            history: "History",
            loadingHistory: "Reading the version history…",
            // The end of the list, when the read stopped at its limit rather than at the beginning
            // of the project. Says what the author gets, not how it is fetched - "load more" would
            // describe the mechanism, and the mechanism (re-read with a larger limit) is not
            // something they should have to know about.
            loadMoreHistory: "Show older versions",
            // The first read of a revision on a project with a remote fetches it over the network,
            // so this is a real wait rather than a courtesy spinner.
            loadingRevision: "Opening that version…",
            showVersion: "Show this version in the editors",
            // A revision with more than one parent. Marked rather than expanded: the rail is a linear
            // list, and an unmarked merge would be a linear list that lies.
            merge: "Merge",
            changes: "Changes",
            refreshChanges: "Check for changes",
            // The button that submits a version. "Submit" rather than "Commit" because every other
            // line here speaks of versions, and an author who has never used version control has no
            // reason to know the word - and "Submit" rather than "Record" because the remote lore
            // server this grows into will call the same action a submission, so the word is settled
            // now instead of half the surfaces being renamed later.
            commit: "Submit a version",
            // A question rather than an instruction, and it says "optional" because it is: an empty
            // message is a valid revision, and one with no message names itself in the list above.
            commitPlaceholder: "What changed? (optional)",
            commitMessage: "Version message",
            // Asked in the panel, once, while the setting is empty. Says what the name is FOR
            // rather than naming the field: "Author name" is what Settings calls it, and there it
            // sits under a heading that supplies the context this line has to carry on its own.
            authorLabel: "Author recorded on versions",
            authorPlaceholder: "Author name",
            authorSave: "Save",
            // Never instant: the pipeline settles this window's unsaved work, stages the whole
            // project, and waits for the backend to put its stores on disk.
            committing: "Submitting this version…",
            // What pressing Submit says on a tree nobody has changed. The backend refuses - it will
            // not record an empty revision - but this is an answer rather than a failure, and the
            // panel draws it as a note. Its own line rather than reusing "No changes" above: that
            // one describes the tree, this one answers a press.
            nothingToCommit: "Nothing has changed since the last version.",
            // Refused because the app is closing. Rare, and worth its own sentence: the alternative
            // wording an author would otherwise see names koffi and a worker thread.
            closingWithApp: "Studio is closing. Try again after it restarts.",
            // "Nobody has looked yet", which is not the same as "clean" - and the difference matters,
            // because looking is a scan and this surface never does it on its own.
            changesUnknown: "Not checked",
            noChanges: "No changes",
            changesCount: "{count} changed",
            // The per-file list. Every row is display-only, and stays that way now that reading what
            // changed INSIDE a file has landed: that lives in the comparison tab, which opens on a
            // comparison rather than on a file, so a row that looked pressable would land the author
            // on some other file's detail.
            //
            // What the marker on each row means. The backend has no "modified" action of its own -
            // an edited file is reported as KEEP (docs §4.18) and translated on the way out - so
            // these five are Studio's vocabulary and the author never sees the backend's.
            changeKind: {
                added: "Added",
                modified: "Changed",
                deleted: "Deleted",
                moved: "Moved",
                copied: "Copied",
            },
            // Where a move or a copy came from. `{path}` is repository-relative, like the row itself.
            changeFromPath: "from {path}",
            // The only change that stops a version from being submitted, which is why it is called out
            // and why it sorts to the top of the list rather than sitting wherever the path puts it.
            changeConflict: "Unresolved conflict",
            // The list is capped. Said out loud, because a list that quietly stopped at fifty would
            // be read as "that is everything", and the author would submit a version believing they
            // had seen all of what they were submitting.
            changesMore: "{count} more not shown",
            // The palette's entries. Title Case like every other command, and named after the act
            // rather than after the surface: an author searching here knows what they want to do,
            // not which column of the window it happens in.
            command: {
                openRail: "Open Version Control",
                commit: "Submit a Version",
                refreshChanges: "Check for Changes",
                compareChanges: "Compare Changes with the Last Version",
            },
            // Narrowing the list. Says what can be typed rather than "Filter", because the useful
            // thing about it is that a version NUMBER works - that is the one handle an author is
            // sure of, and the rail prints it on every row.
            filterPlaceholder: "Find a version by name or number",
            // Nothing matched. Says how many were searched, because the history is paged and the
            // answer is only ever about what has been read - "Show older versions" below reaches
            // further, and this line is what tells the author that is still worth pressing.
            filterNoMatch: "No match in the {count} versions read so far.",
            today: "Today",
            yesterday: "Yesterday",
            // Comparing against a version the author picked, rather than against the row below.
            // "Base" rather than "reference" or "anchor": it is the older side of the comparison,
            // which is the one thing about it worth knowing, and every comparison in the tab is
            // already drawn as base → later.
            compareBase: {
                set: "Compare other versions with this one",
                clear: "Stop comparing with this version",
                current: "Comparing with {version}",
                compare: "Compare with {version}",
            },
            // Checkpoints are the ones Studio recorded on a timer; there are dozens on a writing day.
            showCheckpoints: "Show {count} checkpoints",
            hideCheckpoints: "Hide checkpoints",
            // What a version Studio recorded on its own says, when it is read back rather than
            // written. The bytes in the repository stay English - they travel to collaborators and
            // outlive whichever language was selected the day they were written - so these are the
            // READING of a closed set of sentences Studio wrote itself
            // (`@shared/vcs/systemRevisionMessage`). Anything else in a message is the author's own
            // words and is drawn verbatim.
            //
            // Two of them do not simply echo the stored bytes, and both are deliberate. `Commit` is
            // a word this interface does not use anywhere else - every other line speaks of
            // versions - so the row says what actually happened: a version was submitted without a
            // name. And `Enable version control` is the imperative on the button that caused it,
            // which reads as an offer in a list of things that already happened.
            systemMessage: {
                unnamed: "Unnamed version",
                enabled: "Version control enabled",
                // The first version of a project the wizard made, as opposed to one an author
                // turned version control on for later.
                created: "Project created",
                merge: "Merge",
                checkpoint: "Checkpoint",
                checkpointClose: "Checkpoint before closing the project",
                checkpointBuild: "Checkpoint before build",
                checkpointRestore: "Checkpoint before restore",
                // `{version}` is a revision number or a hash. Not language, so it is not translated.
                restored: "Restored version {version}",
            },
            // Version control is OPTIONAL - Epic ships no native backend for macOS Intel or Windows
            // ARM64 - so these two say different things because the author can only act on one of
            // them. Neither is rendered as a disabled control: on those machines the feature was never
            // shipped, and a greyed rail would report a broken installation where there is none.
            unavailable: {
                platform: "Version control is not available on this machine.",
                installation: "Version control is not available in this installation of Studio.",
            },
            // The server section of the rail. "Server" rather than "remote": an author who has
            // never used version control knows what a server is, and "remote" is a word that only
            // means anything once you already know the model.
            server: {
                title: "Server",
                // A project with no server, which is every project until someone says otherwise.
                // One line and one button, because connecting is a decision rather than a default.
                none: "Not connected to a server",
                connect: "Connect to a server",
                /**
                 * Choosing which server a project synchronises with.
                 *
                 * The list is what this installation is signed in to, which is managed in
                 * Settings - the last row of the list opens it there. The address field is
                 * for a server that asks nobody who they are: there is no account to add for
                 * one, so it can be in no list.
                 */
                picker: {
                    title: "Connect to a server",
                    // The path on the end of the address, which is what the repository is
                    // called on the server and what a collaborator clones by. Filled in from
                    // the project's folder, because that is the answer nearly every time.
                    nameLabel: "Name on the server",
                    namePlaceholder: "my-game",
                    empty: "No servers have been added.",
                    // The last row of the list. The ellipsis is the convention for a control
                    // that opens somewhere else: this one opens Settings and closes the dialog.
                    add: "Add a server…",
                    manual: "Another address",
                },
                // The one field. Measured: the backend keeps only the ORIGIN of whatever URL it is
                // given and identifies the repository by its own id, so there is genuinely nothing
                // else to type - which is why there is no "repository name" box beside it.
                addressLabel: "Server address",
                addressPlaceholder: "lore://studio.example.lan:41337",
                save: "Connect",
                cancel: "Cancel",
                disconnect: "Disconnect",
                // Reaching the server costs up to two seconds, so it never happens on its own -
                // the panel opens on "not checked" and this is what asks.
                check: "Check the server",
                checking: "Checking the server…",
                notChecked: "Not checked",
                // The server answered and this branch matches it.
                upToDate: "Up to date",
                // Deliberately counted in versions rather than in files: the author submits
                // versions, and the number that tells them whether to push is how many of those
                // have not left this machine.
                localAhead: "Local versions are not on the server",
                remoteAhead: "The server has versions this machine does not",
                // Both moved. Push refuses in this state and says so; syncing merges first.
                diverged: "Local and server versions have both advanced",
                unreachable: "Cannot reach this server",
                // The server answered but would not accept us. This is the ONLY state that shows
                // the credential fields - asking for a token before anyone has been refused is
                // asking a question most authors will never need to answer.
                unauthorized: "This server refused access",
                push: "Send to server",
                pushing: "Sending to the server…",
                // "Already there" is a success. Pressing this twice is an ordinary thing to do.
                pushedAlready: "The server already has these versions",
                sync: "Get from server",
                syncing: "Getting versions from the server…",
                syncedNothing: "Already up to date",
                /**
                 * Signing this installation in to the server, and saying who is signed in.
                 *
                 * The `signedInAs` line is the point of the whole thing: while a session is in
                 * force, the name on a version is the one the server knows this account by,
                 * rather than whatever was typed into a preference on this machine.
                 */
                signIn: {
                    required: "This server requires you to sign in before a project can be pointed at it.",
                    // A quiet line, not a button: most servers ask nobody who they are, and
                    // this is a control they can ignore rather than one they must answer.
                    open: "Sign in to this server",
                    signedInAs: "Signed in as {name}",
                    signOut: "Sign out",
                    // Deliberately not "auth endpoint": the author is being asked where to sign
                    // in, and the word for the machinery behind it is not theirs to learn.
                    addressLabel: "Sign-in address",
                    addressPlaceholder: "https://studio.example.lan:41402",
                    // "Access token" rather than "password", because it is not one and cannot
                    // be chosen, remembered or reset by the person pasting it.
                    tokenLabel: "Access token",
                    tokenPlaceholder: "Paste the token you were given",
                    // Where a token comes from, in one line, because there is nowhere else to
                    // learn it: nothing in Studio can issue one.
                    hint: "Whoever runs this server issues the token and hands it to you.",
                    /**
                     * Trusting the authority a server's certificate is issued from.
                     *
                     * Two readers, and the words have to work for both. Where the token names
                     * this authority, the comparison is already made and this is a decision.
                     * Where it names none, the fingerprint is here to be checked against what
                     * somebody was told - which is what everybody did before, and still works.
                     *
                     * Nothing here calls it a "root CA" or a "trust store": what the author is
                     * agreeing to is said in the sentence, and the name for the machinery is
                     * not theirs to learn.
                     */
                    trust: {
                        open: "Trust this server on this computer",
                        title: "Trust this server?",
                        vouched: "The token you pasted names this authority, and this is the authority answering at that address.",
                        compare: "Check this fingerprint against the one whoever runs the server gives you, over something other than this connection.",
                        authorityLabel: "Issued by",
                        fingerprintLabel: "Fingerprint",
                        // The cost of being wrong, in one sentence, without softening it. The
                        // account rather than the computer is not a detail: it is what bounds
                        // the damage, and it is the reason the per-user store is used.
                        meaning: "Anything holding this authority's key can then issue a certificate for any address, and this account will believe it. Only this account on this computer is affected.",
                        manual: "This system has no per-account trust store, so Studio cannot do it. Run this, then sign in again:",
                        copy: "Copy the command",
                        confirm: "Trust it",
                        cancel: "Cancel",
                    },
                    submit: "Sign in",
                    cancel: "Cancel",
                    /**
                     * How signing in ended, said once and in words.
                     *
                     * Not a pair of version numbers: Studio pins its half and the server runs
                     * whatever its operator installed, and asking an author which pairs work
                     * asks them for knowledge they have no way to have.
                     */
                    reach: {
                        ready: "This server and this copy of Studio can work together.",
                        // Signed in, and the server will not hand over this project. A different
                        // failure from a refused token, and the remedy is a different person's.
                        notPermitted: "Signed in, but this account has not been given this project. Ask whoever runs the server for access.",
                        // The sign-in address answered and the server itself did not, which is
                        // two ports and usually two firewall rules.
                        dataPortSilent: "Signed in, but the server itself did not answer.",
                    },
                    /**
                     * Why a sign-in did not happen.
                     *
                     * Four of these arrive from the backend as one identical sentence, so each
                     * is written here from the reason Studio worked out for itself. The
                     * certificate one is the only failure in this product whose remedy is a
                     * command a person runs outside Studio, and it says so plainly rather than
                     * offering a button that cannot exist.
                     */
                    problem: {
                        scheme: "A sign-in address has to start with https:// or ucs-auth://.",
                        token: "That is not a token this server issued. Paste the whole token you were given.",
                        // Answered only after a token has been read and found to name no
                        // endpoint, which is what reveals the address field. Most tokens name
                        // one and nobody sees this.
                        address: "This token does not say where to sign in, so the address is needed too.",
                        // The token named no authority, so there is a comparison left to make
                        // and it is a person's. Shown above the offer, not instead of it.
                        certificate:
                            "This computer has not been told to trust the authority this server signs with. "
                            + "Its fingerprint is {fingerprint}.",
                        // The token named one authority and a different one answered. Not a
                        // step that was missed: this is what standing in the way looks like,
                        // and nothing here offers to trust it.
                        mismatch:
                            "The server at that address is not the one this token is for. The token names "
                            + "{expected}, and {found} answered. Do not trust it; ask whoever runs the "
                            + "server what happened.",
                        unreachable: "Nothing answered at that address ({detail}).",
                        refused: "The server would not accept that token ({detail}).",
                        unknown: "The sign-in did not finish ({detail}).",
                    },
                },
            },
            // A sync whose merge could not settle. Sticky rather than inline, because the sync
            // leaves the version view on its way out and the rail re-reads on that change, which
            // clears the inline error before anyone could read it.
            //
            // It names where the author goes next rather than what happened, because the sync
            // deliberately does not take them there: reporting and stopping is the same discipline
            // as never creating a repository on their behalf.
            syncConflictTitle: "Some files could not be merged",
            // Two wordings rather than "file(s)", per docs/help-system.md §3.
            syncConflictDetailOne:
                "One file changed both here and on the server:\n"
                + "{files}\n"
                + "The remaining changes were merged. Choose which side to keep from the version panel.",
            syncConflictDetailMany:
                "{count} files changed both here and on the server:\n"
                + "{files}\n"
                + "The remaining changes were merged. Choose which side to keep from the version panel.",
            // An open merge, in the rail. Present only while there is one, which is almost never -
            // and then it is the most important thing in the panel.
            mergeOpen: "Merge in progress",
            mergeConflicts: {
                one: "{count} file needs a side chosen",
                other: "{count} files need a side chosen",
            },
            // The automerge settled everything; all that is left is to record it.
            mergeNoConflicts: "Everything merged automatically. Submit a version to finish.",
            mergeResolve: "Finish the merge",
        },
        // Keyboard-shortcut customization (Settings window → Editor) + the "?" cheat sheet overlay.
        keybindings: {
            searchPlaceholder: "Search shortcuts…",
            hint: "Click a shortcut to record a new one. Esc cancels.",
            record: "Record shortcut",
            recording: "Press the new shortcut…",
            reset: "Reset to default",
            resetAll: "Reset All",
            customized: "Customized",
            conflict: "Also bound to {name}",
            empty: "No matching shortcuts",
            openSettings: "Customize Keyboard Shortcuts",
            cheatSheetTitle: "Keyboard Shortcuts",
            cheatSheetCustomize: "Customize…",
            // Category headers in the settings table and cheat sheet (from the static catalog).
            categories: {
                general: "General",
                story: "Story Editor",
                uiEditor: "UI Editor",
                blueprint: "Blueprint Editor",
                storyMotion: "Story Motion",
                assets: "Assets",
                other: "Other",
            },
            // Labels for catalog entries that had no i18n key of their own.
            catalog: {
                commandPalette: "Show and Run Commands",
                quickOpen: "Quick Open",
                cheatSheet: "Show Keyboard Shortcuts",
                contextHelp: "Help for What Is Focused",
                reopenClosedTab: "Reopen Closed Tab",
                undo: "Undo",
                redo: "Redo",
                quickSwitchNext: "Switch to Next Editor Tab",
                quickSwitchPrevious: "Switch to Previous Editor Tab",
                uiEditor: {
                    undo: "Undo",
                    redo: "Redo",
                    copy: "Copy",
                    cut: "Cut",
                    paste: "Paste",
                    duplicate: "Duplicate",
                    group: "Group",
                    ungroup: "Ungroup",
                    selectAll: "Select All",
                    delete: "Delete Selection",
                    rename: "Rename",
                    escape: "Close Menu / Exit Edit",
                    alignLeft: "Align left",
                    alignHorizontalCenter: "Center horizontally",
                    alignRight: "Align right",
                    alignTop: "Align top",
                    alignVerticalCenter: "Center vertically",
                    alignBottom: "Align bottom",
                    distributeHorizontal: "Distribute horizontally",
                    distributeVertical: "Distribute vertically",
                },
                blueprint: {
                    undo: "Undo",
                    redo: "Redo",
                    copy: "Copy Nodes",
                    cut: "Cut Nodes",
                    paste: "Paste Nodes",
                },
                storyMotion: {
                    undo: "Undo",
                    redo: "Redo",
                    delete: "Delete Keyframe",
                    prevFrame: "Step Playhead Back One Frame",
                    nextFrame: "Step Playhead Forward One Frame",
                    prevFrames: "Step Playhead Back Ten Frames",
                    nextFrames: "Step Playhead Forward Ten Frames",
                    playheadStart: "Move Playhead to Start",
                    playheadEnd: "Move Playhead to End",
                },
            },
        },
        // Global project search: the dock panel and the palette's search mode share these.
        search: {
            placeholder: "Search project…",
            // Label on the title-bar search pill (opens the palette in search mode). `{name}` is the
            // current project's name.
            titleBarPlaceholder: "Search in {name}",
            building: "Building search index…",
            // Shown before anything is typed. "Building" and "no results" both had a line; this
            // state fell through to an empty list and rendered a blank panel.
            idle: "Search scenes, characters, story text, assets and blueprints.",
            empty: "No results",
            more: "{count} more",
            // Refined matching, shared with the scene find bar so the same query means one thing.
            caseSensitive: "Match case",
            wholeWord: "Match whole word",
            regex: "Use a regular expression",
            invalidPattern: "Invalid pattern",
            // Project-wide replace of story prose. The trailing number on the button is occurrences,
            // not rows and not the capped visible count.
            // The switch at the end of the option row that brings the replace row in; searching is
            // the common errand, so the panel opens without it.
            toggleReplace: "Replace",
            replacePlaceholder: "Replace with",
            replaceAll: "Replace all",
            replaceRow: "Replace this line",
            // The plan no longer fits the project: something it was going to rewrite has been
            // deleted or changed since. A replace applies completely or not at all, so this refuses
            // rather than writing what is left.
            replaceStale: "The project changed. Search again.",
            // Entity groups come first: the box answers "open the thing called X" before
            // "find the line that says X".
            groups: {
                scene: "Scenes",
                story: "Stories",
                character: "Characters",
                uiSurface: "UI Surfaces",
                blueprint: "Blueprints",
                asset: "Assets",
                storyText: "Story Text",
                variable: "Variables",
                uiTextKey: "UI Text Keys",
                blueprintNode: "Blueprint Nodes",
            },
            // Trailing badge on a result row standing in for several identical ones.
            occurrences: "×{count}",
        },
        // The PyCharm-style project switcher in the title bar: current project name plus a
        // dropdown of recent workspaces. The label says "open" rather than "switch" because a
        // project picked here can do either; `openTarget` is where that is decided.
        projectSwitcher: {
            openAnother: "Open another project",
            recentProjects: "Recent Projects",
            current: "Current",
            openProject: "Open Project…",
            newProject: "New Project…",
            noRecent: "No recent workspaces",
            untitled: "Untitled Project",
            // Asked once a project has been picked, before anything opens. The dialog names the
            // picked project; this line names what happens to the one on screen, which is the
            // part the buttons cannot say. {current} is the project this window is showing.
            openTarget: {
                title: "Open project",
                detail: "Opening in this window closes {current}. Unsaved changes are saved automatically.",
                thisWindow: "Open in this window",
                newWindow: "Open in a new window",
            },
        },
        // In-app confirmation shown before a workspace closes, when `workspace.confirmBeforeClose`
        // is on. The main process drives it over IPC; the dialog supplies its own title/buttons.
        closeConfirm: {
            message: "Close this workspace?",
            detail: "Unsaved changes are saved automatically.",
        },
        // What the workspace says while it is closing. One line per stage of the close the main
        // process runs (see `WorkspaceCloseStage`); the checkpoint is the one that actually takes
        // time, and the one that needs naming.
        closing: {
            title: "Closing workspace",
            saving: "Saving changes…",
            checkpoint: "Recording a version of the project…",
            launcher: "Returning to the launcher…",
        },
        // The same, on the way in. One line per stage of the startup the renderer runs (see
        // `WorkspaceStartupStage`). They name what the window is waiting on rather than what it is
        // doing internally: "services" and "interface" are the author's editor arriving, not a list
        // of objects being constructed.
        opening: {
            title: "Opening workspace",
            preparing: "Opening the project…",
            services: "Loading the project's content…",
            interface: "Preparing the editor…",
        },
    },
} as const;
