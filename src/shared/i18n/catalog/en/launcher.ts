/** `launcher` - the launcher window (sidebar, projects, plugins, learning). */
export const launcher = {
    nav: {
        projects: "Projects",
        // Between Projects and Plugins because it answers the other half of the same
        // question: Projects is what this machine has, Servers is what it could have.
        servers: "Team",
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
        // The one control that opens the add-a-server dialog, on the rule beside the views
        // and in the empty state. It is a tooltip and a label, never a visible word.
        manage: "Add a server",
        empty: {
            title: "No servers",
            description: "Projects on a server appear here.",
            action: "Add a server",
        },
        // Which server is being read, when there is more than one to read.
        choose: "Select a server.",
        newProject: "New Project",
        loading: "Reading the project list",
        noProjects: "This server holds no projects.",
        // The two views of one server, named on the tab strip that switches between them.
        // The roster's own name is `people.title`, which is the same word in both places.
        tabs: {
            projects: "Projects",
        },
        // One act, and it is on the project's own page rather than on its row. "Get" rather
        // than "Clone" - the wizard behind it asks where the copy lands.
        open: "Open",
        get: "Get",
        // Said on the row of a project this machine already holds, as a word beside the
        // description rather than as a mark of its own. It is the question the tab exists to
        // answer, so it stays where the list can be scanned for it.
        here: "On this machine",
        // Said of a project the server has read and found nothing in. Only ever from a count
        // that is there and is zero - a server that has not read the repository says nothing
        // about it, and nothing is what this reads back.
        nothingSent: "Nothing sent yet",
        // Only ever drawn when the server named a time. A server that has not read the
        // repository says nothing about it, and nothing is what this reads back.
        lastVersion: "Last version {date}",
        lastVersionBy: "Last version {date} by {name}",
        problem: {
            noToken: "This server cannot be asked from this installation. Add it again with its token.",
            refused: "This server refused the account signed in here.",
            unreachable: "This server did not answer.",
            // Only reachable while publishing, which this tab does when a project is made
            // for a server. The name is the project's own app id, which the review page
            // named - so the author knows which one is meant without it being repeated here.
            nameTaken: "Another project on this server is already called that.",
            // The name is not repeated here: this tab publishes under the project's app id,
            // which the review page has already named, and the list beside this line is
            // where the project it is already on the server as can be seen.
            alreadyPublished: "This project is already on this server under another name.",
            unknown: "This server could not be read.",
        },
        // A project made here and refused by the server it was made for. The project is on
        // disk and complete; what did not happen is the connection to the server, and the
        // dialog is what opens it so that the version rail can try again.
        unsent: {
            title: "Project not sent",
            message: "{name} was created on this machine. It was not sent to {server}.",
            open: "Open Project",
            close: "Close",
        },
        // What one project's row opens into. Only reached on a server that offers to say
        // something about a project beyond listing it.
        detail: {
            back: "All projects",
            loading: "Reading this project",
            // The overflow beside the one primary control. What is in it is destructive and
            // nobody opened a project to do it, so it costs a second click to reach.
            more: "More actions",
            moreNamed: "More actions for {name}",
            createdBy: "Created by",
            created: "Created",
            lastVersion: "Last version",
            // Only drawn where the server read the project file, so every one of these is
            // a number it gave rather than one this end worked out.
            title: "Title",
            stage: "Stage",
            scenes: "Scenes",
            assets: "Assets",
            // The ordinary answer for a project recorded a moment ago, and the only answer
            // from a deployment whose reader is not working. It replaces the facts rather
            // than filling them with zeroes, and it does not repeat what the server said
            // about it - that sentence is written for whoever runs the server.
            //
            // **About the project file and nothing else.** The versions are asked for
            // separately and can be missing on their own, and this said about a project
            // whose scene count is on screen above it would be a plain contradiction; that
            // state has its own line below.
            unread: "The server has not read this project.",
            // Above `unread` and instead of it: a project nobody has sent anything to has no
            // project file to read, so the two would be one fact told twice.
            empty: "Nothing has been sent to this project.",
            versions: "Recent versions",
            noVersions: "No versions recorded.",
            // A page that came back without them, on a project the server otherwise
            // answered for. Not "none": what is unknown here is the list, not its length.
            versionsUnavailable: "This project's versions are not available.",
            olderVersions: "Older versions are not shown.",
        },
        // Taking a project off a server's list, for the one a failed publish left behind.
        //
        // **The message is the reason this is a dialog at all.** "Remove" beside a project
        // name reads as deleting the project, and the route behind it does not do that - it
        // drops the entry the server lists and leaves what the repository holds where it is.
        // So the limit is written out rather than implied, in the sentence that names both
        // the project and the list it is coming off.
        // What people have said about one project, over the session this Studio holds
        // with the server. Only reached on a deployment that serves conversations.
        discussion: {
            title: "Discussion",
            empty: "No notes on this project.",
            placeholder: "Write a note",
            add: "Add",
            resolve: "Resolve",
            reopen: "Reopen",
            resolved: "Resolved",
            failed: "The note was not sent.",
            // The list could not be read at all. Never the empty state, which says nobody
            // has written anything.
            unavailable: "This project's discussion is not available.",
        },
        forget: {
            action: "Remove from this server",
            title: "Remove from this server",
            message: "{name} will no longer be listed on {server}. Its repository and every version in it stay on the server.",
            confirm: "Remove",
            cancel: "Cancel",
            failed: "The project was not removed.",
        },
        // Who else works on this server. The account addresses are read with the list and
        // shown one at a time, for the member a reader opens.
        people: {
            title: "People",
            loading: "Reading the member list",
            none: "This server holds no accounts.",
            // Marks rather than badges: what they say matters on the day it applies and
            // never otherwise, so they read as words beside a name.
            operator: "Operator",
            disabled: "Disabled",
            serviceAccount: "Service account",
            noAddress: "No address on this account.",
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
