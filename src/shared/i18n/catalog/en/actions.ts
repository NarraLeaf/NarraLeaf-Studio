/** `actions` — global toolbar actions, groups, and their runtime messages. */
export const actions = {
    devMode: {
        tooltip: "Dev Mode",
    },
    preview: {
        tooltip: "Preview",
    },
    build: {
        tooltip: "Build project",
        source: "Build",
        requested: "Build requested for {name}.",
        notWiredTitle: "Project build pipeline is not wired to the toolbar yet.",
        notWiredDetail: " Packaging output will stream here once the build runner is connected.",
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
