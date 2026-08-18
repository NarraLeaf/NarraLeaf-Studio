/** `launcher` - the launcher window (sidebar, projects, plugins, learning). */
export const launcher = {
  nav: {
    projects: "Projects",
    plugins: "Plugins",
    learning: "Learning",
    settings: "Settings"
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
      empty: 'No projects match "{query}".'
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
      subtitle: "Projects you open appear here.",
      openFolder: "Open…"
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
      confirm: "Remove"
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
      errorNotAProject: "That folder is not a NarraLeaf project."
    }
  },
  // Plural example - read with translator.tn("launcher.recentCount", count).
  recentCount: {
    one: "{count} recent project",
    other: "{count} recent projects"
  }
  // The Learning tab's own words all live in the `help` namespace now: it renders the topic
  // registry rather than a card wall, so it has no copy of its own beyond the sidebar entry above.
} as const;
