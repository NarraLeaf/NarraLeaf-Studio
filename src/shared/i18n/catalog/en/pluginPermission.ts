/** `pluginPermission` — the plugin permission-consent dialog (install / trust / filesystem / API requests). */
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
        body1: "Studio identified these privileged controls for this installation:",
        body2: "Approving this install grants the listed controls to this plugin version. Only install plugins you trust.",
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
