/**
 * English catalog — the source of truth for every translatable string.
 *
 * Rules:
 *   - Namespaced by top-level key (`common`, `menu`, `settings`, `launcher`, …).
 *     Add a namespace per app/surface so the tree stays navigable as it grows.
 *   - Leaves are strings. Interpolate with `{name}` placeholders.
 *   - Plurals: give a key `.one` / `.other` (and `.few`/`.many`/… where a locale
 *     needs them) and read it with `translator.tn(baseKey, count)`.
 *   - `as const` is required: the key type and interpolation checks derive from it.
 */
export const en = {
    common: {
        appName: "NarraLeaf Studio",
        ok: "OK",
        cancel: "Cancel",
        save: "Save",
        reset: "Reset",
        close: "Close",
        loading: "Loading…",
    },
    menu: {
        app: {
            preferences: "Preferences…",
        },
        file: {
            title: "File",
            new: "New Workspace",
            open: "Open Workspace",
            export: "Export Project",
            close: "Close Workspace",
        },
        view: {
            title: "View",
        },
        window: {
            title: "Window",
        },
        help: {
            title: "Help",
            welcome: "Open Welcome",
            docs: "Documentation",
        },
    },
    settings: {
        title: "Settings",
        subtitle: "Editor Settings",
        searchPlaceholder: "Search settings…",
        loading: "Loading settings…",
        noResults: "No settings match your search.",
        empty: "No settings available.",
        noneExposed: "No implemented settings are currently exposed.",
        // Category chrome — keys mirror the category `key` in appSettings.ts.
        categories: {
            general: {
                label: "General",
                description: "Application defaults, language, and notifications.",
            },
            appearance: {
                label: "Appearance",
                description: "Interface theme, accent colors, and motion preferences.",
            },
            editor: {
                label: "Editor",
                description: "Font rendering, lines, wrapping and layout defaults.",
            },
            workspace: {
                label: "Workspace",
                description: "Startup behavior, workspace history, and auto-save helpers.",
            },
            sync: {
                label: "Sync",
                description: "Local backup cadence and synchronization helpers.",
            },
            advanced: {
                label: "Advanced",
                description: "Telemetry, developer helpers and experimental toggles.",
            },
        },
        // Individual settings — keyed by the setting they localize.
        items: {
            language: {
                label: "Language",
                description: "Display language for the Studio interface.",
            },
        },
    },
    launcher: {
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
            empty: "No recent projects yet.",
        },
        // Plural example — read with translator.tn("launcher.recentCount", count).
        recentCount: {
            one: "{count} recent project",
            other: "{count} recent projects",
        },
    },
} as const;
