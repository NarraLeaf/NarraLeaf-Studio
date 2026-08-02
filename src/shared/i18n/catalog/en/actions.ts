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
