/** `launcher` - the launcher window (sidebar, projects, plugins, learning). */
export const launcher = {
    nav: {
        projects: "Projects",
        plugins: "Plugins",
        learning: "Learning",
        settings: "Settings",
    },
    projects: {
        title: "Projects",
        // "Add", not "New": the wizard behind this button also unpacks a package and clones from
        // a server, and neither of those creates anything.
        addProject: "Add Project",
        openProject: "Open Project",
        recentTitle: "Recent Projects",
        openFolder: "Open Folder",
        openNamed: "Open {name}",
        search: {
            placeholder: "Search projects",
            clear: "Clear search",
            empty: "No projects match \"{query}\".",
        },
        // The whole tab before the first project - see WelcomePane. One line, and it is the tier-2
        // "what will be here": the two tiles under it are the "how to put something here".
        empty: {
            subtitle: "Projects you open appear here.",
        },
        removeFromRecent: "Remove from recent",
        moreActions: "More actions",
        moreActionsNamed: "More actions for {name}",
        removeNamedFromRecent: "Remove {name} from recent projects",
        errorCreate: "Failed to add project.",
        errorOpenFolder: "Failed to open folder.",
        // Startup sweep over the recent list - see useMissingRecentProjects.
        missing: {
            reasonFolderMissing: "This project folder was deleted or moved",
            reasonNotAProject: "This folder is no longer a NarraLeaf project",
            dialogTitle: "Project not found",
            note: "Removing only updates this list. Nothing on disk is deleted.",
            relocate: "Locate…",
            remove: "Remove from list",
            errorNotAProject: "That folder is not a NarraLeaf project.",
        },
    },
    // Plural example - read with translator.tn("launcher.recentCount", count).
    recentCount: {
        one: "{count} recent project",
        other: "{count} recent projects",
    },
    // The Learning tab's own words all live in the `help` namespace now: it renders the topic
    // registry rather than a card wall, so it has no copy of its own beyond the sidebar entry above.
} as const;
