/**
 * `workspace` - the workspace window shell plus the game-localization panel.
 * The `localization` subtree is already translated; `shell` covers the window
 * chrome (toolbar, tabs, panels, common workspace dialogs).
 */
export const workspace = {
    localization: {
        panel: {
            languagesTitle: "Languages",
            languagesHint: "Languages of the game itself. The source is the one you write in; the rest are translated against it.",
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
            localeMismatchDetail: "Translations land in the language you picked, whatever the file says.",
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
            reviewAllClear: "All caught up, nothing left to review.",
            staleHint: "The source line changed after this translation. Review it, then save to re-anchor.",
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
            languagesHint: "Languages you have voice-over for. Independent of the text languages.",
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
            pickupEmpty: "Nothing outdated, no pickup needed.",
            importSummary: "Linked {linked} takes ({unmatched} unmatched, {failed} failed)",
            importFailed: "Could not import the audio files",
            importScript: "Import recording script…",
            importScriptSummary: "Applied {applied} rows ({unchanged} unchanged, {unknown} not voiced)",
            importScriptFailed: "Could not read that recording script",
            namingTitle: "Recording filename pattern",
            namingHint: "Tokens: {tokens}. Imported audio matches back by this name.",
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
            outdatedHint: "The line changed after this take was imported. Re-import the clip to count it again.",
            noStories: "Create a story first. Its spoken lines appear here to voice.",
            emptyStory: "This story has no spoken lines yet.",
            emptyFilter: "Nothing matches this filter.",
            auditionAllClear: "All caught up, nothing left to audition.",
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
        intro: "Run a check to load that part of the project and see what it says. Anything that loads can be browsed as usual.",
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
            restoreExplain: "Every file in the project is replaced with that version. Nothing is lost from the history: the current state is recorded first, and the restore is added as a new version.",
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
            detailOne: "A file could not be read, so part of your project is missing from this window. Usually an interrupted save, a sync or backup tool writing at the same time, or a plugin. Editing now can save this incomplete state over the files that are still intact.",
            detailMany: "{count} files could not be read, so part of your project is missing from this window. Usually an interrupted save, a sync or backup tool writing at the same time, or a plugin. Editing now can save this incomplete state over the files that are still intact.",
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
            unreadableDetail: "{reason} The file was left exactly as it was; nothing has been written over it.",
            unreadableDetailQuarantined: "{reason} The file was left exactly as it was, and a copy of it is at {path}.",
            consoleUnreadable: "read failed ({kind}): {path} · {reason}",
            consoleQuarantined: "kept a copy of the unreadable file at {path}",
            // A write refused because the workspace is frozen. Not a failure: nothing is wrong, and
            // nothing will be retried. The wording has to say why, or it reads as a bug.
            frozenTitle: "Nothing is being saved right now",
            frozenDetailRevision: "You are looking at version {version}. Nothing is saved while you look.",
            frozenDetailManual: "The workspace is frozen. Unfreeze it to start saving again.",
            // A merge has no "unfreeze": the working tree holds two sides at once until the
            // merge is finished, so naming that is the only useful thing this can say.
            frozenDetailMerge: "A merge is unfinished. Finish it from the version panel to start saving again.",
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
            failedDetail: "These are still showing what they had before: {stores}. Reopen the project to read them again.",
            console: "re-read the project from disk ({cause}): {count} of them",
            consoleFailed: "could not re-read {label}: {error}",
        },
        // Freezing the workspace: project data stops being written, editor state carries on. Named
        // for what the author gets ("stop saving"), not for the mechanism.
        freeze: {
            command: "Freeze Project (Stop Saving Changes)",
            release: "Unfreeze Project (Resume Saving Changes)",
            enteredTitle: "Project frozen",
            enteredDetail: "Your project files are left untouched until you unfreeze it.",
            leftTitle: "Project unfrozen",
            leftDetail: "Changes are being saved again.",
            // Hover text on every top-bar control the freeze switches off. Deliberately one string
            // for all of them: the author has to learn "this is what a frozen project looks like"
            // once, not read a different excuse on each button. The controls are disabled rather
            // than hidden precisely so there is something to hover.
            unavailable: "Not available while the project is frozen. Unfreeze it to use this again.",
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
            shownDetail: "The editors are read-only, and your files on disk are untouched.",
            noneTitle: "There is no earlier revision",
            noneDetail: "This project has only one revision, so there is nothing earlier to show.",
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
            viewingVersion: "You are looking at version {version}",
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
                "Your project files will be replaced with the ones from this version. "
                + "Everything you have now is recorded as a checkpoint first, and no version is deleted.",
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
            restoreNotRecordedTitle: "Your files were restored, but the version was not submitted",
            restoreNotRecordedDetail:
                "Your project files are now the ones from version {version}. Submitting that as a new "
                + "version failed ({error}). Nothing is lost; press \"{action}\" to submit it yourself.",
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
            // Never instant: the pipeline settles this window's unsaved work, stages the whole
            // project, and waits for the backend to put its stores on disk.
            committing: "Submitting this version…",
            // "Nobody has looked yet", which is not the same as "clean" - and the difference matters,
            // because looking is a scan and this surface never does it on its own.
            changesUnknown: "Not checked",
            noChanges: "No changes",
            changesCount: "{count} changed",
            // The per-file list. Every row is display-only: reading what changed INSIDE a file is a
            // later milestone, and a row that opened onto nothing would be exactly the promise this
            // panel has been careful not to make.
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
            // Checkpoints are the ones Studio recorded on a timer; there are dozens on a writing day.
            showCheckpoints: "Show {count} checkpoints",
            hideCheckpoints: "Hide checkpoints",
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
                localAhead: "You have versions the server does not",
                remoteAhead: "The server has versions you do not",
                // Both moved. Push refuses in this state and says so; syncing merges first.
                diverged: "You and the server have both moved on",
                unreachable: "Cannot reach this server",
                // The server answered but would not accept us. This is the ONLY state that shows
                // the credential fields - asking for a token before anyone has been refused is
                // asking a question most authors will never need to answer.
                unauthorized: "This server did not accept you",
                push: "Send to server",
                pushing: "Sending to the server…",
                // "Already there" is a success. Pressing this twice is an ordinary thing to do.
                pushedAlready: "The server already has these versions",
                sync: "Get from server",
                syncing: "Getting versions from the server…",
                syncedNothing: "Already up to date",
            },
            // A sync whose merge could not settle. Sticky rather than inline, because the sync
            // leaves the version view on its way out and the rail re-reads on that change, which
            // clears the inline error before anyone could read it.
            //
            // It names where the author goes next rather than what happened, because the sync
            // deliberately does not take them there: reporting and stopping is the same discipline
            // as never creating a repository on their behalf.
            syncConflictTitle: "Some files could not be merged",
            syncConflictDetail:
                "{count} file(s) changed both here and on the server:\n"
                + "{files}\n"
                + "Your other changes did arrive. Choose which side to keep from the version panel.",
            // An open merge, in the rail. Present only while there is one, which is almost never -
            // and then it is the most important thing in the panel.
            mergeOpen: "Merge in progress",
            mergeConflicts: {
                one: "{count} file needs a side chosen",
                other: "{count} files need a side chosen",
            },
            // The automerge settled everything; all that is left is to record it.
            mergeNoConflicts: "Everything merged on its own. Submit a version to finish.",
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
                    selectAll: "Select All",
                    delete: "Delete Selection",
                    rename: "Rename",
                    escape: "Close Menu / Exit Edit",
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
        // dropdown of recent workspaces. A project picked here opens in a window of its own and
        // this window stays, which is why the label says "open" rather than "switch".
        projectSwitcher: {
            openAnother: "Open another project",
            recentProjects: "Recent Projects",
            current: "Current",
            openProject: "Open Project…",
            newProject: "New Project…",
            noRecent: "No recent workspaces",
            untitled: "Untitled Project",
        },
        // In-app confirmation shown before a workspace closes, when `workspace.confirmBeforeClose`
        // is on. The main process drives it over IPC; the dialog supplies its own title/buttons.
        closeConfirm: {
            message: "Close this workspace?",
            detail: "Any changes you have made will be saved automatically.",
        },
        // What the workspace says while it is closing. One line per stage of the close the main
        // process runs (see `WorkspaceCloseStage`); the checkpoint is the one that actually takes
        // time, and the one that needs naming.
        closing: {
            title: "Closing workspace",
            saving: "Saving your changes…",
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
