/**
 * `workspace` - the workspace window shell plus the game-localization panel.
 * The `localization` subtree is already translated; `shell` covers the window
 * chrome (toolbar, tabs, panels, common workspace dialogs).
 */
export const workspace = {
    localization: {
        panel: {
            languagesTitle: "Languages",
            languagesHint: "Languages of the game itself. The source language is the one you write in; every other language is translated against it.",
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
            exportCsv: "Export CSV",
            importCsv: "Import CSV",
            exportDone: "Exported to {path}",
            importSummary: "Imported {applied} translations ({unchanged} unchanged, {unknown} unknown, {skippedEmpty} empty skipped)",
            importFailed: "Could not read the CSV file",
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
            languagesHint: "Languages you have voice-over for. Independent of text languages, so you can voice a game in Japanese while its text stays English.",
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
            dropHint: "Drop audio to assign",
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
        initializing: "Initializing workspace…",
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
            // Category for the version-control commands (freeze, and later: commit, history).
            categoryVersionControl: "Version Control",
            editor: {
                closeTab: "Close Tab",
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
            },
        },
        // Save reporting: the sticky toast raised when a file cannot be written, and the lines the
        // "Storage" console channel carries. A failed write retries on a backoff that never gives
        // up, so the wording says "still trying" rather than "lost".
        save: {
            failedTitle: "Couldn't save {file}",
            failedDetailTransient: "Still retrying in the background. {error}",
            failedDetailPermanent: "This one needs your attention — retrying will not help until it is fixed. {error}",
            retry: "Retry now",
            consoleFailed: "write failed ({code}, attempt {attempt}): {path} - {error}",
            consoleRecovered: "write succeeded: {path}",
            flushFailed: "could not flush {label}: {error}",
            // The read side: a document that is on disk but cannot be understood. The wording leads
            // with what did NOT happen, because the fear this raises is "has Studio eaten my work?".
            unreadableTitle: "Couldn't read {file}",
            unreadableDetail: "{reason} The file was left exactly as it was — nothing has been written over it.",
            unreadableDetailQuarantined: "{reason} The file was left exactly as it was, and a copy of it is at {path}.",
            consoleUnreadable: "read failed ({kind}): {path} - {reason}",
            consoleQuarantined: "kept a copy of the unreadable file at {path}",
            // A write refused because the workspace is frozen. Not a failure: nothing is wrong, and
            // nothing will be retried. The wording has to say why, or it reads as a bug.
            frozenTitle: "Nothing is being saved right now",
            frozenDetailRevision: "You are looking at version {version}. Your project files are left untouched until you go back to the current version.",
            frozenDetailManual: "The workspace is frozen, so changes are not written to your project. Unfreeze it to start saving again.",
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
            unavailable: "Not available while the project is frozen — unfreeze it to use this again.",
        },
        // Browsing history in the real editors, until the version rail exists. "Previous" rather than
        // a picker on purpose: choosing a revision needs a list, the list is the rail, and a milestone
        // whose behaviour cannot be reached by a person cannot be accepted.
        revisionView: {
            showPrevious: "Show the Previous Revision (Read-Only)",
            leave: "Return to the Current Version",
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
            returnToCurrent: "Return to the current version",
            returning: "Returning to the current version…",
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
                + "version failed ({error}). Nothing is lost - press \"{action}\" to submit it yourself.",
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
                reopenClosedTab: "Reopen Closed Tab",
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
            empty: "No results",
            more: "{count} more",
            groups: {
                story: "Story Text",
                asset: "Assets",
                variable: "Variables",
                uiTextKey: "UI Text Keys",
                blueprintNode: "Blueprint Nodes",
            },
        },
        // The PyCharm-style project switcher in the title bar: current project name plus a
        // dropdown of recent workspaces to jump between.
        projectSwitcher: {
            switchProject: "Switch project",
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
    },
} as const;
