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
        newProject: "New Project",
        openProject: "Open Project",
        import: "Import",
        recentTitle: "Recent Projects",
        openFolder: "Open Folder",
        importProject: "Import Project",
        // Getting a project off a version-control server, which is how a second person
        // joins one. In the launcher because at the moment it is needed there is no
        // project open to reach a workspace panel from.
        clone: {
            title: "Get a project from a server",
            // The whole address, name included: that name is what the server knows the
            // repository by, and it is the string the project's owner hands out.
            addressLabel: "Project address",
            addressHint: "Ask whoever set up the project for this address.",
            folderLabel: "Where to put it",
            folderPlaceholder: "Choose an empty folder",
            // Said before they choose, not after: the check happens in the main process
            // and a refusal at that point is a refusal after they had committed to it.
            folderHint: "Must be a new or empty folder.",
            confirm: "Get project",
            cancel: "Cancel",
            // No percentage: the backend reports a clone's progress only once it has
            // finished, so a bar here would sit at zero and then disappear.
            working: "Copying the project from the server. This can take a while.",
            error: "Could not get the project from the server.",
        },
        openNamed: "Open {name}",
        search: {
            placeholder: "Search projects",
            clear: "Clear search",
            empty: "No projects match \"{query}\".",
        },
        removeFromRecent: "Remove from recent",
        moreActions: "More actions",
        moreActionsNamed: "More actions for {name}",
        removeNamedFromRecent: "Remove {name} from recent projects",
        errorCreate: "Failed to create project.",
        errorOpenFolder: "Failed to open folder.",
        errorImport: "Failed to import project.",
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
    plugins: {
        installLocal: "Install from folder",
        search: {
            placeholder: "Search plugins",
            clear: "Clear search",
        },
        tab: {
            installed: "Installed",
            store: "Store",
        },
        emptyList: "No plugins installed",
        emptyFiltered: "No plugins match “{query}”.",
        authorize: "Authorize",
        uninstall: "Uninstall",
        builtIn: "Built-in",
        permissions: "Permissions",
        noPermissions: "No special permissions",
        updateAvailable: "Update available",
        // Shown when the entry's studioVersion range excludes this build, so the
        // install/update button is withheld rather than failing in the main process.
        requiresStudio: "This plugin requires Studio {range}. You are running {version}.",
        openReleasePage: "View release notes",
        homepage: "Homepage",
        field: {
            status: "Status",
            version: "Version",
            publisher: "Publisher",
            entries: "Entries",
            categories: "Categories",
            installed: "Installed",
            updated: "Updated",
        },
        status: {
            enabled: "Enabled",
            disabled: "Disabled",
            needsAuthorization: "Needs authorization",
        },
        store: {
            install: "Install",
            installed: "Installed",
            update: "Update",
            needsStudio: "Needs Studio {range}",
            emptyList: "No plugins available in the registry.",
            offline: "Couldn't reach the plugin registry.",
            retry: "Try again",
        },
        task: {
            installing: "Installing plugin…",
            downloading: "Downloading plugin…",
            installed: "Plugin installed.",
            authorizing: "Waiting for authorization…",
            authorized: "Plugin authorized.",
            enabling: "Enabling plugin…",
            disabling: "Disabling plugin…",
            enabled: "Plugin enabled.",
            disabled: "Plugin disabled.",
            uninstalling: "Uninstalling plugin…",
            uninstalled: "Plugin uninstalled.",
        },
        error: {
            load: "Failed to load plugins",
            install: "Failed to install plugin",
            approve: "Failed to approve plugin",
            update: "Failed to update plugin",
            uninstall: "Failed to uninstall plugin",
            registry: "Failed to reach the plugin registry",
            download: "Failed to download plugin",
        },
    },
    learning: {
        hint: "Tutorials, examples, and documentation for building with NarraLeaf. Links open in your browser.",
        openInBrowser: "Open {name} in your browser",
        categories: {
            tutorials: "Tutorials",
            examples: "Examples",
            docs: "Documentation",
        },
    },
} as const;
