import { AppSettingDefinition, SettingCategory, SettingScope } from "@/lib/settings/models";
import { SettingValueType } from "@/lib/settings/types";
import {
    EDITOR_FONT_FAMILY_DEFAULT,
    EDITOR_FONT_FAMILY_OPTIONS,
    EDITOR_FONT_SIZE_DEFAULT,
    EDITOR_FONT_SIZE_MAX,
    EDITOR_FONT_SIZE_MIN,
} from "@/lib/settings/editorFontOptions";
import {
    MAX_ACTIVE_EDITORS_DEFAULT,
    MAX_ACTIVE_EDITORS_MAX,
    MAX_ACTIVE_EDITORS_MIN,
} from "@/lib/settings/editorLayoutOptions";
import { DEFAULT_LOCALE, LOCALE_META, SUPPORTED_LOCALES } from "@shared/i18n";

/**
 * Category metadata used by the shared settings UI.
 */
export const AppSettingCategories: SettingCategory[] = [
    {
        key: "general",
        label: "General",
        labelKey: "settings.categories.general.label",
        description: "Application defaults, language, and notifications.",
        descriptionKey: "settings.categories.general.description",
        order: 0,
    },
    {
        key: "appearance",
        label: "Appearance",
        labelKey: "settings.categories.appearance.label",
        description: "Interface theme, accent colors, and motion preferences.",
        descriptionKey: "settings.categories.appearance.description",
        order: 1,
    },
    {
        key: "editor",
        label: "Editor",
        labelKey: "settings.categories.editor.label",
        description: "Font rendering, lines, wrapping and layout defaults.",
        descriptionKey: "settings.categories.editor.description",
        order: 2,
    },
    {
        key: "workspace",
        label: "Workspace",
        labelKey: "settings.categories.workspace.label",
        description: "Startup behavior, workspace history, and auto-save helpers.",
        descriptionKey: "settings.categories.workspace.description",
        order: 3,
    },
    {
        key: "sync",
        label: "Sync",
        labelKey: "settings.categories.sync.label",
        description: "Local backup cadence and synchronization helpers.",
        descriptionKey: "settings.categories.sync.description",
        order: 4,
    },
    {
        key: "advanced",
        label: "Advanced",
        labelKey: "settings.categories.advanced.label",
        description: "Telemetry, developer helpers and experimental toggles.",
        descriptionKey: "settings.categories.advanced.description",
        order: 5,
    },
];

/**
 * Implemented application-wide settings.
 *
 * Do not add placeholders here. A setting belongs in this list only after
 * production code reads the stored value and applies it to real behavior.
 */
export const AppSettings: AppSettingDefinition[] = [
    {
        // Applied by the i18n runtime (`src/shared/i18n`): changing this writes the
        // `app.language` global-state key, which the main process broadcasts so every
        // window re-localizes live. Options are locale codes; the dropdown shows each
        // language's endonym via `optionLabels`.
        key: "app.language",
        category: "general",
        scope: SettingScope.Global,
        type: SettingValueType.Enum,
        label: "Language",
        labelKey: "settings.items.language.label",
        description: "Display language for the Studio interface.",
        descriptionKey: "settings.items.language.description",
        defaultValue: DEFAULT_LOCALE,
        options: [...SUPPORTED_LOCALES],
        optionLabels: Object.fromEntries(
            SUPPORTED_LOCALES.map((code) => [code, LOCALE_META[code].nativeName]),
        ),
    },
    {
        // Applied by the Story scene editor via `storyEditorTextStyle.tsx`.
        key: "editor.fontSize",
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Integer,
        label: "Story editor font size",
        labelKey: "settings.items.editorFontSize.label",
        description: `Font size (px) for dialogue, narration, and choice text in the story scene editor (${EDITOR_FONT_SIZE_MIN}–${EDITOR_FONT_SIZE_MAX}).`,
        descriptionKey: "settings.items.editorFontSize.description",
        descriptionParams: { min: EDITOR_FONT_SIZE_MIN, max: EDITOR_FONT_SIZE_MAX },
        defaultValue: EDITOR_FONT_SIZE_DEFAULT,
    },
    {
        // Applied by the Story scene editor via `storyEditorTextStyle.tsx`.
        key: "editor.fontFamily",
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Enum,
        label: "Story editor font",
        labelKey: "settings.items.editorFontFamily.label",
        description: "Typeface used for story text in the scene editor.",
        descriptionKey: "settings.items.editorFontFamily.description",
        defaultValue: EDITOR_FONT_FAMILY_DEFAULT,
        options: [...EDITOR_FONT_FAMILY_OPTIONS],
    },
    {
        // Applied by the workspace editor area (`EditorGroup` keep-alive logic).
        key: "editor.maxActiveEditors",
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Integer,
        label: "Maximum active editors",
        labelKey: "settings.items.maxActiveEditors.label",
        description: `How many editor tabs stay loaded at once so their scroll position and focus are preserved when you switch between them (${MAX_ACTIVE_EDITORS_MIN}–${MAX_ACTIVE_EDITORS_MAX}). Tabs beyond this reload when reopened.`,
        descriptionKey: "settings.items.maxActiveEditors.description",
        descriptionParams: { min: MAX_ACTIVE_EDITORS_MIN, max: MAX_ACTIVE_EDITORS_MAX },
        defaultValue: MAX_ACTIVE_EDITORS_DEFAULT,
    },
    {
        // Applied by the main process in `App.handleWorkspaceCloseRequest`: the workspace
        // window's close guard shows a native confirmation sheet before letting the close through.
        key: "workspace.confirmBeforeClose",
        category: "workspace",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Confirm before closing a workspace",
        labelKey: "settings.items.confirmBeforeClose.label",
        description: "Ask for confirmation when you close a workspace window.",
        descriptionKey: "settings.items.confirmBeforeClose.description",
        defaultValue: false,
    },
    {
        // Applied by the main process in `App.handleWorkspaceCloseRequest`: when on, closing a
        // workspace reopens the launcher first. When off the close simply stands, so the app
        // quits if the workspace was the last window.
        key: "workspace.returnToLauncherOnClose",
        category: "workspace",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Return to the home screen when closing a workspace",
        labelKey: "settings.items.returnToLauncherOnClose.label",
        description: "Closing a workspace goes back to the home screen. Turn this off to quit NarraLeaf Studio instead when no other window is open.",
        descriptionKey: "settings.items.returnToLauncherOnClose.description",
        defaultValue: true,
    },
    {
        // Read by the main-process GameBuildManager (readElectronMirror) and
        // passed to electron-builder as electronDownload.mirror for cross-platform
        // game builds. Empty = official Electron download source.
        key: "build.electronMirror",
        category: "advanced",
        scope: SettingScope.Global,
        type: SettingValueType.String,
        label: "Electron download mirror",
        labelKey: "settings.items.electronMirror.label",
        description: "Mirror URL for downloading Electron when building games for other platforms. Leave empty to use the official source.",
        descriptionKey: "settings.items.electronMirror.description",
        defaultValue: "",
    },
];
