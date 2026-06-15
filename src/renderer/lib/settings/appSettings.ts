import { AppSettingDefinition, SettingCategory } from "@/lib/settings/models";

/**
 * Category metadata used by the shared settings UI.
 */
export const AppSettingCategories: SettingCategory[] = [
    {
        key: "general",
        label: "General",
        description: "Application defaults, language, and notifications.",
        order: 0,
    },
    {
        key: "appearance",
        label: "Appearance",
        description: "Interface theme, accent colors, and motion preferences.",
        order: 1,
    },
    {
        key: "editor",
        label: "Editor",
        description: "Font rendering, lines, wrapping and layout defaults.",
        order: 2,
    },
    {
        key: "workspace",
        label: "Workspace",
        description: "Startup behavior, workspace history, and auto-save helpers.",
        order: 3,
    },
    {
        key: "sync",
        label: "Sync",
        description: "Local backup cadence and synchronization helpers.",
        order: 4,
    },
    {
        key: "advanced",
        label: "Advanced",
        description: "Telemetry, developer helpers and experimental toggles.",
        order: 5,
    },
];

/**
 * Implemented application-wide settings.
 *
 * Do not add placeholders here. A setting belongs in this list only after
 * production code reads the stored value and applies it to real behavior.
 */
export const AppSettings: AppSettingDefinition[] = [];
