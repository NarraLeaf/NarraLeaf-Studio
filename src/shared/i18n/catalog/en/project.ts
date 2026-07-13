/** `project` — the Project settings sidebar: overview hub plus slide-in sub-pages (details, assets, dependencies, settings). */
export const project = {
    nav: {
        details: {
            title: "Details",
            description: "Name, identifier, and metadata",
        },
        assets: {
            title: "Assets",
            description: "Application icons for each platform",
        },
        dependencies: {
            title: "Dependencies",
            description: "Plugins this project relies on",
        },
        settings: {
            title: "Settings",
            description: "Networking and packaging behavior",
        },
    },
    home: {
        untitledProject: "Untitled project",
    },
    subPage: {
        backAria: "Back to project overview",
    },
    details: {
        nameLabel: "Application Name",
        namePlaceholder: "Application name",
        nameRequired: "Application name is required.",
        identifierLabel: "Identifier",
        identifierHelper: "Set when the project was created and used for packaging.",
        versionLabel: "Version",
        authorLabel: "Author",
        authorPlaceholder: "Author, organization, or email",
        websiteLabel: "Website",
        descriptionPlaceholder: "Describe your project…",
        required: "Required",
    },
    assets: {
        iconMissing: "Icon file missing",
        iconSaved: "{platform} icon saved.",
        uploadIcon: "Upload {platform} icon",
        iconAlt: "{platform} icon",
        noIcon: "No icon selected",
        icnsPreview: "ICNS preview",
    },
    settings: {
        allowHttpTitle: "Allow HTTP",
        allowHttpDescription: "When off, the game is confined to the app protocol and all HTTP/HTTPS requests are blocked.",
        encryptAssetsTitle: "Protect assets",
        encryptAssetsDescription: "Encrypt assets, plugin code and the story bundle in packaged and previewed builds. Raises the bar against casual extraction; does not affect Dev Mode.",
    },
    dependencies: {
        rescan: "Rescan",
        scanning: "Scanning project…",
        empty: "No plugin dependencies — this project uses only built-in Studio features.",
        banner: {
            blocked: "One or more plugins are disabled for this project because their installed version is incompatible. Update or reinstall them to restore full functionality.",
            warnings: "Some dependencies need attention — a plugin is outdated or a soft dependency is unavailable.",
        },
        status: {
            ready: "Ready",
            outdated: "Outdated",
            missing: "Missing",
            incompatible: "Incompatible",
            disabled: "Disabled",
        },
        meta: {
            requires: "Requires {version}",
            installed: "Installed {version}",
            notInstalled: "not installed",
            builtIn: "Built-in",
            dataOnly: "data only",
        },
        usage: {
            blueprintNode: {
                one: "{count} node",
                other: "{count} nodes",
            },
            widget: {
                one: "{count} widget",
                other: "{count} widgets",
            },
            storage: {
                one: "{count} store",
                other: "{count} stores",
            },
            storyAction: {
                one: "{count} action",
                other: "{count} actions",
            },
        },
    },
} as const;
