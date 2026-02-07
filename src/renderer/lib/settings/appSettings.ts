import { RuntimeSettingType } from "@/lib/workspace/services/settings/types";
import { AppSettingCategoryKey, AppSettingDefinition, SettingCategory, SettingScope } from "@/lib/settings/models";

/**
 * Categorized metadata used for the shared settings UI.
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

const languageOptions = [
    { value: "en", label: "English" },
    { value: "zh", label: "简体中文" },
];

const themeOptions = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
    { value: "auto", label: "Auto (System)" },
];

const accentOptions = [
    { value: "blue", label: "Blue" },
    { value: "green", label: "Green" },
    { value: "purple", label: "Purple" },
    { value: "teal", label: "Teal" },
    { value: "orange", label: "Orange" },
];

const fontFamilyOptions = [
    { value: "inter", label: "Inter" },
    { value: "system", label: "System" },
    { value: "monospace", label: "Monospace" },
];

/**
 * Definitions for every application-wide setting that should live in global state.
 */
export const AppSettings: AppSettingDefinition[] = [
    // General
    {
        key: "app.language",
        category: "general",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Enum,
        label: "Language",
        description: "Set the language used across the application interface.",
        defaultValue: "en",
        options: languageOptions.map(option => option.value),
    },
    {
        key: "app.notificationsEnabled",
        category: "general",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Boolean,
        label: "Enable Notifications",
        description: "Show notification toasts for updates and background tasks.",
        defaultValue: true,
    },
    {
        key: "app.autoCheckUpdates",
        category: "general",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Boolean,
        label: "Auto-check for updates",
        description: "Automatically check for new releases in the background.",
        defaultValue: true,
    },
    // Appearance
    {
        key: "ui.themeMode",
        category: "appearance",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Enum,
        label: "Theme Mode",
        description: "Choose between dark, light, or match the system theme.",
        defaultValue: "auto",
        options: themeOptions.map(option => option.value),
    },
    {
        key: "ui.accentColor",
        category: "appearance",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Enum,
        label: "Accent Color",
        description: "Accent color applied to controls and highlights.",
        defaultValue: "blue",
        options: accentOptions.map(option => option.value),
    },
    {
        key: "ui.compactMode",
        category: "appearance",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Boolean,
        label: "Compact Spacing",
        description: "Use tighter spacing throughout the interface.",
        defaultValue: false,
    },
    {
        key: "ui.reduceMotion",
        category: "appearance",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Boolean,
        label: "Reduce Motion",
        description: "Turn off most animations to improve accessibility.",
        defaultValue: false,
    },
    // Editor
    {
        key: "editor.fontSize",
        category: "editor",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Integer,
        label: "Font Size",
        description: "Editor base font size in pixels.",
        defaultValue: 14,
    },
    {
        key: "editor.fontFamily",
        category: "editor",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Enum,
        label: "Font Family",
        description: "Preferred font family for editor panes.",
        defaultValue: "inter",
        options: fontFamilyOptions.map(option => option.value),
    },
    {
        key: "editor.lineNumbers",
        category: "editor",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Boolean,
        label: "Show Line Numbers",
        description: "Display line numbers in editors and previews.",
        defaultValue: true,
    },
    {
        key: "editor.softWrap",
        category: "editor",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Boolean,
        label: "Soft Wrap",
        description: "Wrap long lines to avoid horizontal scrolling.",
        defaultValue: false,
    },
    // Workspace
    {
        key: "workspace.restoreLastWorkspace",
        category: "workspace",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Boolean,
        label: "Restore Last Workspace",
        description: "Automatically restore the last workspace on launch.",
        defaultValue: true,
    },
    {
        key: "workspace.confirmOnClose",
        category: "workspace",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Boolean,
        label: "Confirm on Close",
        description: "Warn before closing the workspace window.",
        defaultValue: true,
    },
    {
        key: "workspace.recentProjectsLimit",
        category: "workspace",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Integer,
        label: "Recent Projects",
        description: "How many recent projects to keep in the launcher list.",
        defaultValue: 10,
    },
    {
        key: "workspace.autoSave",
        category: "workspace",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Boolean,
        label: "Auto Save",
        description: "Enable workspace-level auto-saving for projects.",
        defaultValue: true,
    },
    // Sync
    {
        key: "sync.autoBackup",
        category: "sync",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Boolean,
        label: "Auto Backup",
        description: "Trigger a backup after closing a workspace.",
        defaultValue: true,
    },
    {
        key: "sync.backupIntervalMinutes",
        category: "sync",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Integer,
        label: "Backup Interval",
        description: "Minutes between automatic backups.",
        defaultValue: 30,
    },
    {
        key: "sync.backupPath",
        category: "sync",
        scope: SettingScope.Global,
        type: RuntimeSettingType.String,
        label: "Backup Location",
        description: "Folder path where local backups are stored.",
        defaultValue: "",
    },
    // Advanced
    {
        key: "advanced.enableTelemetry",
        category: "advanced",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Boolean,
        label: "Enable Telemetry",
        description: "Allow anonymous usage data to be sent.",
        defaultValue: false,
    },
    {
        key: "advanced.enableDevTools",
        category: "advanced",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Boolean,
        label: "Show DevTools Shortcut",
        description: "Expose shortcuts to open the developer console.",
        defaultValue: false,
    },
    {
        key: "advanced.experimentalFeatures",
        category: "advanced",
        scope: SettingScope.Global,
        type: RuntimeSettingType.Boolean,
        label: "Use Experimental Features",
        description: "Unlock experimental UI and tooling.",
        defaultValue: false,
    },
];
