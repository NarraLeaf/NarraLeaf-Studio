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
        // Dropdown that switches which mode the button runs; disabled while a mode is running.
        switchMode: "Switch run mode",
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
        close: {
            tooltip: "Close the current workspace",
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
