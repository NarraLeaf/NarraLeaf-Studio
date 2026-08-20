/** `launcher` - the launcher window (sidebar, projects, plugins, learning). */
export const launcher = {
    nav: {
        projects: "Projects",
        // Between Projects and Plugins because it answers the other half of the same
        // question: Projects is what this machine has, Servers is what it could have.
        servers: "Servers",
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
        //
        // The second tile has its own label instead of reusing `openFolder`. That one lives in the
        // header, where a label has to survive on its own as a tooltip; here the tiles sit side by
        // side as one choice, and the trailing ellipsis is what tells the author a file dialog
        // opens next - it would say nothing as a header tooltip. The first tile keeps `addProject`,
        // since the wizard behind it still does more than create.
        empty: {
            title: "Welcome to NarraLeaf Studio",
            subtitle: "Opened projects appear here.",
            openFolder: "Open…",
        },
        // Named after the OS that will answer, because that is what the author is about to see.
        // Three of them rather than one "Show in file manager": Finder and File Explorer are what
        // those two systems call themselves, and a menu that invents its own word for them reads
        // like it opens something else. The generic wording is only the fallback for the systems
        // with no one name.
        revealInFinder: "Show in Finder",
        revealInExplorer: "Show in File Explorer",
        revealInFileManager: "Show in File Manager",
        errorReveal: "Failed to open the project folder.",
        // "From the recent list", not "from recent": the sentence has to be readable next to a
        // project the author may believe this deletes. The dialog behind it says outright that it
        // does not.
        removeFromRecent: "Remove from Recent List",
        removeConfirm: {
            title: "Remove from Recent List",
            message: "{name} will no longer appear in this list. Nothing on disk is deleted.",
            confirm: "Remove",
        },
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
    // The Servers tab. It lists what exists on the servers this installation is signed in to;
    // what is already on this disk is the Projects tab's answer and is not repeated here.
    servers: {
        // Adding a server signs the whole installation in, so it happens in Settings and this
        // tab points at it - from the end of the list, and from the empty state.
        manage: "Manage servers",
        empty: {
            title: "No servers",
            description: "Projects on a server appear here.",
            action: "Add a server",
        },
        // Which server is being read, when there is more than one to read.
        choose: "Select a server.",
        signedInAs: "Signed in as {name}",
        newProject: "New Project",
        loading: "Reading the project list",
        noProjects: "This server holds no projects.",
        // One action per row, and only one: the project is either already on this disk or it
        // is not. "Get" rather than "Clone" - the wizard behind it asks where the copy lands.
        open: "Open",
        get: "Get",
        // Only ever drawn when the server named a time. A server that has not read the
        // repository says nothing about it, and nothing is what this reads back.
        lastVersion: "Last version {date}",
        lastVersionBy: "Last version {date} by {name}",
        problem: {
            noToken: "This server cannot be asked from this installation. Add it again with its token.",
            refused: "This server refused the account signed in here.",
            unreachable: "This server did not answer.",
            unknown: "This server could not be read.",
        },
        create: {
            title: "New project on {server}",
            name: "Name",
            description: "Description",
            descriptionOptional: "Optional",
            submit: "Create",
            cancel: "Cancel",
            failed: "The project was not created.",
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
