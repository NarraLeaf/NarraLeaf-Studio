/**
 * `plugins` - everything about managing plugins, wherever they are managed.
 *
 * These strings used to live under `launcher.plugins`, back when the Launcher's
 * Plugins tab was the only place a plugin could be installed or switched off.
 * The workspace now has a plugin panel of its own over the same list, so the
 * words moved out of the surface that happened to show them first. `launcher.nav`
 * still owns the Launcher's own tab label.
 */
export const plugins = {
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
    requiresStudio: "This plugin requires Studio {range}. The installed version is {version}.",
    openReleasePage: "View release notes",
    homepage: "Homepage",
    moreActions: "More actions",
    moreActionsNamed: "More actions for {name}",
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
        offline: "Could not reach the plugin registry.",
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
        reloading: "Reloading plugin…",
        reloaded: "Plugin reloaded.",
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
    /**
     * The panel's temporary state over one project's dependency table: the plugins the project
     * declares it needs, and what each row wants done about it.
     *
     * The state words are not here. A row's version verdict is written by
     * `project.dependencies.status`, and a row's own controls borrow the store's and the switch's
     * words - Install, Update, Enable, Authorize - because the author reads them together with the
     * list they came from. Only the words this screen is the first to need live here.
     */
    dependencies: {
        title: "Project dependencies",
        /**
         * Said by the warning raised when a project opens, and again at the top of the screen that
         * warning leads to, so the screen confirms what brought the author to it rather than
         * restating it differently.
         *
         * "Not available" covers all three of absent, withheld and switched off on purpose: it is
         * the one thing true of every row the count includes, and each row then says which of the
         * three it is.
         */
        unavailable: {
            one: "{count} plugin this project needs is not available.",
            other: "{count} plugins this project needs are not available.",
        },
        allReady: "Every plugin this project needs is available.",
        /** The warning's action, and the way into the screen. */
        open: "Open dependencies",
        installAll: "Install all",
        /** What a row reports once its remedy has been applied; the other two words are borrowed. */
        updated: "Updated",
        authorized: "Authorized",
        /** A dependency naming a plugin the registry does not publish. There is nothing to press. */
        notInRegistry: "Not in the registry",
        /** Published, but not at a version this project can use. */
        noCompatibleVersion: "No compatible version",
        task: {
            running: "Installing dependencies…",
            done: "Dependencies installed.",
            partial: "Some plugins were not installed.",
        },
    },
    /**
     * The workspace panel's half: what a plugin is doing *in this window*, which
     * the Launcher cannot say because it has no project open.
     */
    workspace: {
        reload: "Reload in this workspace",
        activity: {
            running: "Running here",
            // Enabled, has a studio entry, and still did not come up in this window.
            stopped: "Not running here",
            runtimeOnly: "Game runtime only",
            runtimeOnlyHint: "This plugin only extends the running game. It contributes nothing to the editor.",
            suppressed: "Off for this project",
            suppressedHint: "The installed version is incompatible with the one this project was authored against. Update it, or update the project's dependency table from Project ▸ App.",
            failed: "Failed to load",
        },
        // A plugin that changed state while the workspace could not act on it.
        pendingReopen: "Takes effect the next time this project opens.",
        /**
         * Shown once anything about the installed set changes, and it is a hedge on purpose.
         * Switching a plugin off reclaims what the host handed it - panels, nodes, widgets, actions -
         * but nothing can reclaim what its code did on its own: a listener on `window`, a patched
         * global, a timer. Most plugins come and go cleanly; the ones that do not leave no trace the
         * panel could detect, so the honest line is that a restart is what guarantees a clean slate.
         */
        restartHint: "Some plugin changes take effect only after the workspace is restarted.",
        /** The banner's own action: flush every pending save, then reload this window. */
        restart: "Restart",
        restarting: "Saving changes and restarting…",
        recoveryNotice: "Recovery mode loads no plugins. Changes here apply the next time the project opens normally.",
        /** The action on the toasts below, and anywhere else that hands the author to this panel. */
        openPanel: "Open plugins panel",
        error: {
            activate: "Failed to start {name} in this workspace",
            deactivate: "Failed to stop {name} in this workspace",
            /** A plugin threw while loading into this window. The reason is the toast's detail. */
            loadFailed: "{name} failed to load",
            hostFailed: "Could not load plugins",
        },
    },
} as const;
