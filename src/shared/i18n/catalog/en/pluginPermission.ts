/**
 * `pluginPermission` - plugin permission copy: the consent dialog (install /
 * trust / filesystem / API requests) and the install-permission breakdown that
 * the launcher's plugin details reuse.
 */
export const pluginPermission = {
    title: "Plugin Permission",
    window: {
        launcher: "Launcher",
        settings: "Settings",
        workspace: "Workspace",
        projectWizard: "Project Wizard",
        devMode: "Dev Mode",
        pluginPermission: "Plugin Permission",
        studio: "Studio",
    },
    install: {
        type: "Plugin Install Request",
        title: "{requester} requests to install {plugin}",
        body1: "Studio identified what this install grants:",
        body2: "Approving this install grants everything listed to this plugin version. Only install plugins you trust.",
        source: "Source: {source}",
    },
    filesystem: {
        type: "File System Permission Request",
        title: "{plugin} requests file access",
        body1: "This plugin will be able to use the requested file system control after you approve it.",
        bodyPermanent: "Choosing Allow Once grants this only for the current Studio session.",
        bodySession: "This request is for the current Studio session.",
        permissionRecursive: "{mode} inside {path}",
        permissionSingle: "{mode} for {path}",
    },
    api: {
        type: "Plugin API Permission Request",
        title: "{plugin} requests {capability}",
        body1: "This plugin will be able to call the requested Studio API after approval.",
        body2: "Only approve this if the plugin needs the capability for the action you started.",
    },
    trust: {
        type: "Plugin Trust Request",
        title: "{requester} requests to trust {plugin}",
        body1: "Trusted plugins can be enabled by Studio without repeating the initial trust prompt.",
        body2: "Only trust plugins from sources you recognize.",
        permission: "Trust this plugin identity",
    },
    generic: {
        type: "Plugin Permission Request",
        title: "{plugin} requests a Studio permission",
        body: "Review the request before allowing it.",
    },
    mode: {
        read: "Read access",
        write: "Write access",
        readwrite: "Read and write access",
    },
    /**
     * The install-permission breakdown, grouped by blast radius rather than by
     * declaration site: a native binary shipped to every player is not the same
     * kind of ask as a Studio API call, so they do not share a flat list.
     */
    permissions: {
        section: {
            sidecar: "Native program",
            sidecarNote: "This plugin ships a native program that runs inside the game you build.",
            buildDependency: "Build-time downloads",
            runtime: "In your game",
            studio: "Studio permissions",
        },
        sidecarPlatforms: "Runs on {platforms}",
        buildDependencyHosts: "Downloads from {hosts}",
        /**
         * Phrased around the player's data, not the API name - "state.write"
         * means nothing to the person deciding whether to trust the plugin.
         */
        runtimeCapability: {
            store: "Store its own data alongside the player's saves",
            events: "Observe game progress (scenes, dialogue, choices, saves)",
            stateRead: "Read story variables",
            stateWrite: "Change story variables",
            savesRead: "Read the player's save list and metadata",
            savesWrite: "Overwrite the player's saves and load them",
            uiOverlay: "Draw on top of the game",
            assets: "Resolve packaged asset URLs",
            locale: "Read and follow the game language",
        },
    },
    button: {
        dontAllow: "Don't Allow",
        deny: "Deny",
        allowOnce: "Allow Once",
        allow: "Allow",
        alwaysAllow: "Always Allow",
        granting: "Granting",
    },
    error: {
        load: "Failed to load permission request",
        grant: "Failed to grant permission",
    },
} as const;
