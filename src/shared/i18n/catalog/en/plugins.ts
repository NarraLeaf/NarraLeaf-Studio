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
    requiresStudio: "This plugin requires Studio {range}. You are running {version}.",
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
            runtimeOnlyHint: "This plugin only extends the running game, so there is nothing for it to do in the editor.",
            suppressed: "Off for this project",
            suppressedHint: "The installed version is incompatible with the one this project was authored against. Update it, or update the project's dependency table from Project → Dependencies.",
            failed: "Failed to load",
        },
        // Warned once at load, naming the plugins this project's dependency table turned away.
        suppressedNotice: "Not loaded for this project: {names}. The installed version is incompatible with the one the project was authored against — see the Plugins panel.",
        // A plugin that changed state while the workspace could not act on it.
        pendingReopen: "Takes effect the next time this project opens.",
        /**
         * Shown once anything about the installed set changes, and it is a hedge on purpose.
         * Switching a plugin off reclaims what the host handed it - panels, nodes, widgets, actions -
         * but nothing can reclaim what its code did on its own: a listener on `window`, a patched
         * global, a timer. Most plugins come and go cleanly; the ones that do not leave no trace the
         * panel could detect, so the honest line is that a restart is what guarantees a clean slate.
         */
        restartHint: "Some plugin changes may need the workspace restarted to take effect.",
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
