/** `settings` — the Settings window (registry-driven; see appSettings.ts). */
export const settings = {
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
} as const;
