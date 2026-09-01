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
        // Which build variant Dev Mode, Preview and Test assemble as. The row is only there when
        // the project has a variant to pick, so most projects never see it.
        runAs: "Run as",
            // The DLC a run has installed. "with" rather than "as": an edition is what the build
            // is, and DLC are what is beside it.
            runWithDlc: "Run with DLC",
            dlcCount: "{active} of {total}",
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
    },
    export: {
        chooseFolder: "Choose a folder for the exported project package.",
        failed: "Failed to export project.",
        success: {
            one: "Exported project package with {count} file.",
            other: "Exported project package with {count} files.",
        },
    },
} as const;
