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
import {
    ZOOM_PERCENT_DEFAULT,
    ZOOM_PERCENT_MAX,
    ZOOM_PERCENT_MIN,
} from "@shared/constants/zoom";
import { DEFAULT_LOCALE, LOCALE_META, SUPPORTED_LOCALES } from "@shared/i18n";
import { clearAllProjectStats } from "@/lib/stats/clearAllProjectStats";
import { DASHBOARD_OPEN_DEFAULT_KEY } from "@shared/constants/dashboard";

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
        // Applied by the main process (`applyThemeMode`): the stored mode drives
        // nativeTheme.themeSource, every renderer's prefers-color-scheme follows it
        // and flips the CSS tokens in styles.css, and window background colors track
        // nativeTheme in baseApp.
        key: "ui.themeMode",
        category: "appearance",
        scope: SettingScope.Global,
        type: SettingValueType.Enum,
        label: "Theme",
        labelKey: "settings.items.themeMode.label",
        description: "Color theme for the Studio interface. \"Follow system\" switches with the operating system.",
        descriptionKey: "settings.items.themeMode.description",
        defaultValue: "auto",
        options: ["auto", "light", "dark"],
        optionLabelKeys: {
            auto: "settings.items.themeMode.options.auto",
            light: "settings.items.themeMode.options.light",
            dark: "settings.items.themeMode.options.dark",
        },
    },
    {
        // Applied by the main process to every Studio window's webContents
        // (`AppWindow.applyStoredZoom`). Cmd/Ctrl +/-/0 write this same key, so the
        // shortcuts and this field stay in agreement. The Dev Mode window is
        // excluded — it renders the game at its real stage size.
        key: "ui.zoomPercent",
        category: "appearance",
        scope: SettingScope.Global,
        type: SettingValueType.Integer,
        label: "Interface zoom",
        labelKey: "settings.items.zoomPercent.label",
        description: `Zoom level of the Studio interface (${ZOOM_PERCENT_MIN}%-${ZOOM_PERCENT_MAX}%).`,
        descriptionKey: "settings.items.zoomPercent.description",
        descriptionParams: { min: ZOOM_PERCENT_MIN, max: ZOOM_PERCENT_MAX },
        defaultValue: ZOOM_PERCENT_DEFAULT,
        min: ZOOM_PERCENT_MIN,
        max: ZOOM_PERCENT_MAX,
        step: 5,
        unit: "%",
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
        // The fallback half of a per-project preference (see `@shared/constants/dashboard`): read
        // by `useWorkspaceEditorSession` only for projects whose dashboard toggle has never been
        // touched. A project that has decided for itself ignores this.
        key: DASHBOARD_OPEN_DEFAULT_KEY,
        category: "workspace",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Show the project dashboard by default",
        labelKey: "settings.items.dashboardOnOpen.label",
        description:
            "Whether projects you haven't decided about open their dashboard on entering the workspace. Each project can override this from its own dashboard.",
        descriptionKey: "settings.items.dashboardOnOpen.description",
        defaultValue: true,
    },
    {
        // Handled entirely by `clearAllProjectStats`; nothing is stored under this key — it is
        // only the identity of the button. Scoped to every project because the Settings window is
        // its own window and has no current project; the per-project reset lives on the dashboard.
        key: "dashboard.clearAllStats",
        category: "workspace",
        scope: SettingScope.Global,
        type: SettingValueType.Action,
        label: "Clear all statistics data",
        labelKey: "settings.items.clearAllStats.label",
        description: "Erase the recorded writing history, active time, and build history of every project. Counts derived from your projects are unaffected.",
        descriptionKey: "settings.items.clearAllStats.description",
        defaultValue: null,
        actionLabel: "Clear",
        actionLabelKey: "settings.items.clearAllStats.action",
        confirmLabelKey: "settings.items.clearAllStats.confirm",
        danger: true,
        onInvoke: clearAllProjectStats,
    },
    {
        // Read by WorkspaceLayout: hides the bottom status bar and gives its height back to the
        // dock layout when off.
        key: "ui.statusBar.visible",
        category: "appearance",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Show status bar",
        labelKey: "settings.items.statusBarVisible.label",
        description: "The slim strip along the bottom of the workspace (runtime status, word count, quick toggles).",
        descriptionKey: "settings.items.statusBarVisible.description",
        defaultValue: true,
    },
    {
        // Stores the filename inside userData/backgrounds (written by the pick handler). The
        // workspace overlays this image across the whole window at the opacity below.
        key: "ui.backgroundImage",
        category: "appearance",
        scope: SettingScope.Global,
        type: SettingValueType.Action,
        label: "Custom background image",
        labelKey: "settings.items.backgroundImage.label",
        description: "Overlay a picture of your choice across the workspace, watermark-style.",
        descriptionKey: "settings.items.backgroundImage.description",
        defaultValue: null,
        actionLabel: "Choose…",
        actionLabelKey: "settings.items.backgroundImage.action",
        skipConfirm: true,
        onInvoke: async () => {
            const { getInterface } = await import("@/lib/app/bridge");
            const result = await getInterface().app.pickBackgroundImage();
            if (result.success && result.data.file) {
                await getInterface().app.state.setGlobalState("ui.backgroundImage", result.data.file);
            }
        },
    },
    {
        key: "ui.backgroundImage.clear",
        category: "appearance",
        scope: SettingScope.Global,
        type: SettingValueType.Action,
        label: "Remove background image",
        labelKey: "settings.items.backgroundImageClear.label",
        description: "Go back to the plain workspace background.",
        descriptionKey: "settings.items.backgroundImageClear.description",
        defaultValue: null,
        actionLabel: "Remove",
        actionLabelKey: "settings.items.backgroundImageClear.action",
        skipConfirm: true,
        onInvoke: async () => {
            const { getInterface } = await import("@/lib/app/bridge");
            await getInterface().app.state.setGlobalState("ui.backgroundImage", null);
        },
    },
    {
        // Read by the workspace's background overlay; percent so the slider reads naturally.
        key: "ui.backgroundOpacity",
        category: "appearance",
        scope: SettingScope.Global,
        type: SettingValueType.Slider,
        label: "Background image opacity",
        labelKey: "settings.items.backgroundOpacity.label",
        description: "How strongly the custom background shows through (percent).",
        descriptionKey: "settings.items.backgroundOpacity.description",
        defaultValue: 8,
        min: 2,
        max: 40,
        step: 1,
        unit: "%",
    },
    {
        // Nothing is stored under this key — it is only the button's identity. The keybinding
        // table lives in the workspace (the binding registry only exists there), so the button
        // writes a request signal to global state (broadcast to all windows) and closes this
        // window to reveal the workspace with the tab open.
        key: "keybindings.open",
        category: "workspace",
        scope: SettingScope.Global,
        type: SettingValueType.Action,
        label: "Keyboard shortcuts",
        labelKey: "settings.items.openKeybindings.label",
        description: "Customize keyboard shortcuts in the workspace's searchable binding table.",
        descriptionKey: "settings.items.openKeybindings.description",
        defaultValue: null,
        actionLabel: "Customize",
        actionLabelKey: "settings.items.openKeybindings.action",
        skipConfirm: true,
        availability: async () => {
            const { getInterface } = await import("@/lib/app/bridge");
            const result = await getInterface().app.countWorkspaceWindows();
            const enabled = result.success && result.data.count > 0;
            return enabled
                ? { enabled: true }
                : { enabled: false, reasonKey: "settings.items.openKeybindings.needsWorkspace" };
        },
        onInvoke: async () => {
            const { getInterface } = await import("@/lib/app/bridge");
            const { KEYBINDINGS_OPEN_REQUEST_SETTINGS_KEY } = await import(
                "@/lib/workspace/services/ui/KeybindingService"
            );
            await getInterface().app.state.setGlobalState(KEYBINDINGS_OPEN_REQUEST_SETTINGS_KEY, Date.now());
            window.close();
        },
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
