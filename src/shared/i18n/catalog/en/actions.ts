/** `actions` - global toolbar actions, groups, and their runtime messages. */
export const actions = {
    devMode: {
        tooltip: "Dev Mode",
    },
    preview: {
        tooltip: "Preview",
    },
    build: {
        tooltip: "Build project",
    },
    // The Run split-button: a run button carrying the selected mode plus a dropdown to switch it.
    run: {
        devMode: "Dev Mode",
        preview: "Preview",
        runDevMode: "Run Dev Mode",
        runPreview: "Run Preview",
        // Dropdown that switches which mode the button runs; the mode rows go inert while one runs.
        switchMode: "Switch run mode",
        // The same dropdown, now that it also carries Production Build - so it is no longer only
        // about switching modes, and the button that opens it cannot say that it is.
        menu: "Run and build",
        // Production Build, folded into the dropdown to make room for the version control widget.
        productionBuild: "Production Build…",
        // Beside Production Build because it is the same kind of thing: it produces a file
        // rather than launching anything.
        exportPatch: "Export Patch…",
        // Opens the clean-up dialog: Studio's per-item tidying, run over the whole project.
        cleanup: "Clean Up Project…",
        // Which build variant Dev Mode, Preview and Test assemble as. The row is only there when
        // the project has a variant to pick, so most projects never see it.
        runAs: "Run as",
            // The DLC a run has installed. "with" rather than "as": an edition is what the build
            // is, and DLC are what is beside it.
            runWithDlc: "Run with DLC",
            dlcCount: "{active} of {total}",
        // Which of the project's languages a Dev Mode run is shown in, in place of the player's saved
        // language and the system language. Only there when the project has two or more languages.
        language: "Language",
        languageDetail: "The language Dev Mode runs in",
        // The default entry: the game picks the language the way it would for a player.
        languageAuto: "Automatic",
        // The chosen language was removed from the project, so the choice went back to the default.
        languageRemoved: "{name} was removed from the project. Dev Mode language is now Automatic.",
        // Said by the main process when a Dev Mode run is asked for in a language the project no
        // longer has. The run does not start in some other language instead.
        languageMissingRun: "The Dev Mode language {code} is not one of this project's languages. Choose another under Language in the run menu.",
        // Whether a preview of this project holds its content the way a protected build does. Only
        // offered where the project protects its assets; off unless this machine turns it on.
        previewAsShipped: "Preview as shipped",
        previewAsShippedDetail: "Preview runs the protected form players receive, and takes longer to start.",
        // The same choice on the Run button, so a preview that seals is never mistaken for an
        // ordinary one.
        asShipped: "As shipped",
        // Clears the save slots and persistent data a run leaves behind, for when the author's own
        // game poisons that state and crashes on launch. Dev Mode and Preview keep theirs apart, so
        // the submenu resets one without touching the other.
        resetData: "Reset player data",
        // The row for the mode that is running now, disabled: resetting under a live process would
        // race its next write.
        resetWhileRunning: "Stop it to reset its data",
        resetDevModeConfirm: "Reset Dev Mode player data?",
        resetPreviewConfirm: "Reset Preview player data?",
        resetDetail: "Every save slot and all persistent data for this project are removed.",
        resetDone: "Player data reset.",
        resetFailed: "Could not reset player data.",
    },
    // The clean-up dialog. Each task re-runs something Studio already does one item at a time.
    cleanup: {
        title: "Clean up project",
        scanning: "Checking the project",
        scanFailed: "Could not check the project: {message}",
        task: {
            avatars: "Auto-frame dialog avatars",
            projectCache: "Clear project cache",
            blueprintLayout: "Format all blueprints",
            danglingNodes: "Delete unwired blueprint nodes",
            orphanComments: "Delete orphaned comments",
            orphanTranslations: "Delete orphaned translations",
        },
        // Under the avatar row: whether differentials that already have a framing are framed again.
        avatarsOverwrite: "Replace existing framings",
        amount: {
            differentials: { one: "{count} differential", other: "{count} differentials" },
            blueprints: { one: "{count} blueprint", other: "{count} blueprints" },
            nodes: { one: "{count} node", other: "{count} nodes" },
            comments: { one: "{count} comment", other: "{count} comments" },
            translations: { one: "{count} translation", other: "{count} translations" },
        },
        nothing: "Nothing to do",
        cacheBusy: "In use by a build or preview",
        noUndo: "Cannot be undone",
        run: "Clean Up",
        failed: "Clean-up stopped: {message}",
        done: {
            title: "Project cleaned up: {summary}.",
            nothing: "Project cleaned up. Nothing needed changing.",
            separator: ", ",
            avatars: "{count} avatars framed",
            projectCache: "{size} of cache cleared",
            blueprintLayout: "{count} blueprints formatted",
            danglingNodes: "{count} nodes deleted",
            orphanComments: "{count} comments deleted",
            orphanTranslations: "{count} translations deleted",
        },
    },
    file: {
        label: "File",
        new: {
            label: "New Workspace",
            tooltip: "Create a new workspace",
        },
        open: {
            label: "Open Workspace",
            tooltip: "Open an existing workspace",
        },
        export: {
            label: "Export Project",
            tooltip: "Export the current project as a package",
        },
        revealProject: {
            label: "Show Project Folder",
            tooltip: "Show this project's folder in the file manager",
            failed: "The project folder could not be opened.",
        },
        returnToLauncher: {
            label: "Back to Launcher",
            tooltip: "Leave this project and go back to the launcher",
        },
        close: {
            label: "Close Window",
            tooltip: "Close this window",
        },
    },
    help: {
        label: "Help",
        welcome: {
            label: "Open Welcome",
            tooltip: "Open welcome screen",
        },
        about: {
            label: "About",
            tooltip: "About NarraLeaf Studio",
        },
        // Every log Studio keeps, on disk and in this window's memory, in one zip the author can
        // attach to a report. Opens a save dialog, hence the ellipsis.
        exportLogs: {
            label: "Export Logs…",
            tooltip: "Save all Studio logs as a zip archive",
            done: "Logs saved to {path}",
            failed: "The logs could not be exported.",
        },
    },
    export: {
        chooseFolder: "Choose a folder for the exported project package.",
        failed: "Could not export the project.",
        failedWithReason: "{headline} {reason}",
        // Why an export failed, from the code the main process answered with. The project being
        // read and the folder being written are the two sides, so each sentence is about one of them.
        reason: {
            folderProtected: "The chosen folder is inside Studio's own storage. Choose another folder.",
            folderReadOnly: "Studio is not allowed to write to the chosen folder.",
            folderMissing: "The chosen folder no longer exists.",
            diskFull: "The disk is full.",
            projectUnreadable: "Studio is not allowed to read some of the project's files.",
            projectFileBusy: "A file in the project is in use by another program.",
            projectChanged: "A file in the project was moved or deleted during the export. Export again.",
        },
        success: {
            one: "Exported project package with {count} file.",
            other: "Exported project package with {count} files.",
        },
    },
} as const;
