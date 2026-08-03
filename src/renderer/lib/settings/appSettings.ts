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
    EDITOR_SURFACE_OPACITY_DEFAULT,
    EDITOR_SURFACE_OPACITY_MAX,
    EDITOR_SURFACE_OPACITY_MIN,
    EDITOR_SURFACE_OPACITY_STEP,
} from "@/lib/settings/editorSurfaceOptions";
import {
    MAX_ACTIVE_EDITORS_DEFAULT,
    MAX_ACTIVE_EDITORS_MAX,
    MAX_ACTIVE_EDITORS_MIN,
} from "@/lib/settings/editorLayoutOptions";
import { SLASH_AT_ALIAS_KEY, slashAtAliasDefault } from "@/lib/settings/slashAliasOptions";
import { LOCALIZED_COMMANDS_DEFAULT, LOCALIZED_COMMANDS_KEY } from "@/lib/settings/commandLanguageOptions";
import { HIDE_PARAM_NAMES_DEFAULT, HIDE_PARAM_NAMES_KEY } from "@/lib/settings/commandParamNameOptions";
import {
    ACCENT_COLOR_DEFAULT,
    ACCENT_PRESETS,
    ACCENT_SWATCHES,
} from "@shared/constants/accent";
import {
    ZOOM_PERCENT_DEFAULT,
    ZOOM_PERCENT_MAX,
    ZOOM_PERCENT_MIN,
} from "@shared/constants/zoom";
import { DEFAULT_LOCALE, LOCALE_META, SUPPORTED_LOCALES } from "@shared/i18n";
import { clearAllProjectStats } from "@/lib/stats/clearAllProjectStats";
import { DASHBOARD_OPEN_DEFAULT_KEY } from "@shared/constants/dashboard";
import { KEYBINDING_OVERRIDES_SETTINGS_KEY } from "@/lib/workspace/services/ui/KeybindingService";

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
        key: "plugins",
        label: "Plugins",
        labelKey: "settings.categories.plugins.label",
        description: "Plugin store and registry.",
        descriptionKey: "settings.categories.plugins.description",
        order: 5,
    },
    {
        key: "advanced",
        label: "Advanced",
        labelKey: "settings.categories.advanced.label",
        description: "Telemetry, developer helpers and experimental toggles.",
        descriptionKey: "settings.categories.advanced.description",
        order: 6,
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
        description: "Color theme for the Studio interface.",
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
        // Applied by the renderer (`lib/appearance`): the stored value overrides the
        // `--nl-primary` channels on the root element, which every `*-primary` utility in the
        // product resolves through. Stored as a preset id or a `#rrggbb` hex — the presets are
        // the guided path (hue-shifts of the brand anchor at low saturation, see
        // @shared/constants/accent), the picker is there for anything else. What keeps "any
        // color" honest is `--nl-on-primary`, the derived ink that stops a pale accent from
        // making every primary button unreadable. Studio chrome only; a game keeps the anchor.
        key: "ui.accentColor",
        category: "appearance",
        scope: SettingScope.Global,
        type: SettingValueType.Color,
        label: "Accent color",
        labelKey: "settings.items.accentColor.label",
        description: "Color used for selection, focus rings, and primary buttons.",
        descriptionKey: "settings.items.accentColor.description",
        defaultValue: ACCENT_COLOR_DEFAULT,
        options: ACCENT_PRESETS.map(preset => preset.id),
        optionLabels: Object.fromEntries(ACCENT_PRESETS.map(preset => [preset.id, preset.label])),
        optionLabelKeys: {
            teal: "settings.items.accentColor.options.teal",
            sky: "settings.items.accentColor.options.sky",
            indigo: "settings.items.accentColor.options.indigo",
            rose: "settings.items.accentColor.options.rose",
            slate: "settings.items.accentColor.options.slate",
        },
        optionColors: ACCENT_SWATCHES,
        allowCustomColor: true,
        // Live preview while dragging; the commit on release is what persists and broadcasts.
        onPreview: (value) => {
            void import("@/lib/appearance").then(({ previewAccentColor }) => previewAccentColor(value));
        },
    },
    {
        // Applied by the renderer in two halves, because one cannot reach the other: the
        // `.nl-reduce-motion` class on the root element neutralizes CSS transitions and
        // animations (styles.css), and the MotionConfig in `lib/renderApp` does the same for
        // framer-motion, which animates from JS where no CSS rule applies. Game content — the
        // story preview's stage, Dev Mode — is exempt from both.
        key: "ui.reduceMotion",
        category: "appearance",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Reduce motion",
        labelKey: "settings.items.reduceMotion.label",
        description: "Turn off animated transitions in the Studio interface. Your game's own animations are unaffected.",
        descriptionKey: "settings.items.reduceMotion.description",
        defaultValue: false,
    },
    {
        // Applied by the main process to every Studio window's webContents
        // (`AppWindow.applyStoredZoom`). Cmd/Ctrl +/-/0 write this same key, so the
        // shortcuts and this field stay in agreement. The Dev Mode window is
        // excluded - it renders the game at its real stage size.
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
        description: `Font size (px) for story text in the scene editor (${EDITOR_FONT_SIZE_MIN}-${EDITOR_FONT_SIZE_MAX}).`,
        descriptionKey: "settings.items.editorFontSize.description",
        descriptionParams: { min: EDITOR_FONT_SIZE_MIN, max: EDITOR_FONT_SIZE_MAX },
        defaultValue: EDITOR_FONT_SIZE_DEFAULT,
    },
    {
        // Published as the `--nl-editor-surface-opacity` custom property by `lib/appearance`, and
        // consumed by the one `.nl-editor-surface` rule in styles.css — the story editor's prose
        // area, the inspector's field area and the Dev Mode debug panel all resolve their fill
        // through it. Only meaningful with a workspace wallpaper on: the wallpaper is opt-in, so
        // the hard opaque plate it puts under the prose has to be adjustable rather than pinned.
        key: "editor.surfaceOpacity",
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Integer,
        label: "Editor surface opacity",
        labelKey: "settings.items.editorSurfaceOpacity.label",
        description: "Opacity of the surfaces behind story text and inspector fields.",
        descriptionKey: "settings.items.editorSurfaceOpacity.description",
        defaultValue: EDITOR_SURFACE_OPACITY_DEFAULT,
        min: EDITOR_SURFACE_OPACITY_MIN,
        max: EDITOR_SURFACE_OPACITY_MAX,
        step: EDITOR_SURFACE_OPACITY_STEP,
        unit: "%",
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
        description: `How many editor tabs stay loaded at once, keeping their scroll position and focus (${MAX_ACTIVE_EDITORS_MIN}-${MAX_ACTIVE_EDITORS_MAX}). The rest reload when reopened.`,
        descriptionKey: "settings.items.maxActiveEditors.description",
        descriptionParams: { min: MAX_ACTIVE_EDITORS_MIN, max: MAX_ACTIVE_EDITORS_MAX },
        defaultValue: MAX_ACTIVE_EDITORS_DEFAULT,
    },
    {
        // Read by the blueprint editor (useBlueprintDragConnectSettings): when on, dragging off an
        // execution (next) output pin onto empty canvas opens a menu of compatible nodes and wires
        // the chosen one automatically. Gates only the exec-output direction.
        key: "blueprint.dragConnect.execOutput",
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Drag from execution output pins to create nodes",
        labelKey: "settings.items.blueprintDragConnectExecOutput.label",
        description: "Drop on empty canvas to pick a node; it is wired in after that pin.",
        descriptionKey: "settings.items.blueprintDragConnectExecOutput.description",
        defaultValue: true,
    },
    {
        // Read by the blueprint editor (useBlueprintDragConnectSettings). Gates the data-output
        // direction: only nodes that accept the dragged pin's value type are offered.
        key: "blueprint.dragConnect.dataOutput",
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Drag from data output pins to create nodes",
        labelKey: "settings.items.blueprintDragConnectDataOutput.label",
        description: "Drop on empty canvas to pick a node; only nodes that accept that value type are listed.",
        descriptionKey: "settings.items.blueprintDragConnectDataOutput.description",
        defaultValue: true,
    },
    {
        // Read by the blueprint editor (useBlueprintDragConnectSettings). Gates dragging off any
        // input pin: the new node's matching output is wired into that input.
        key: "blueprint.dragConnect.input",
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Drag from input pins to create nodes",
        labelKey: "settings.items.blueprintDragConnectInput.label",
        description: "Drop on empty canvas to pick a node; its output is wired into that pin.",
        descriptionKey: "settings.items.blueprintDragConnectInput.description",
        defaultValue: true,
    },
    {
        // Applied by the Story scene editor: `handleInsertValueChange` rewrites a leading "@" to "/"
        // in the insert slot, so "@" opens the action creator exactly as "/" does. The default is
        // device-locale dependent (on for Simplified Chinese, where the "/" key types "、"), which is
        // why nothing is stored under this key until the user toggles it - the value shown here, and
        // the editor's fallback, both come from `slashAtAliasDefault()`. See globalState.ts.
        key: SLASH_AT_ALIAS_KEY,
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Use “@” to open the action creator",
        labelKey: "settings.items.slashAtAlias.label",
        description: "Avoids the clash between / and 、 in Chinese input methods.",
        descriptionKey: "settings.items.slashAtAlias.description",
        defaultValue: slashAtAliasDefault(),
    },
    {
        // Applied by `lib/i18n/commandLocale`: this value picks the translator the Story action
        // creator reads - its menu labels and categories, the parameter candidates, the inline ghost
        // hint, the command reference, the verb the line itself settles on and the verb a committed
        // row reads back - and the same locale keys the three derived alias tables the parser
        // consults (`commands/registry.ts`, `commands/localizedParams.ts`, `commands/localizedEnums.ts`),
        // so the word shown and the word accepted are always one word. A switch rather than a third
        // language picker:
        // the only two useful answers are "my language" and "the one the grammar is written in". The
        // canonical English spellings parse in every locale regardless.
        key: LOCALIZED_COMMANDS_KEY,
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Show story commands in the interface language",
        labelKey: "settings.items.localizedCommands.label",
        description: "Turn this off to keep the action creator's command names, parameter names and values in English. Their English spellings work either way.",
        descriptionKey: "settings.items.localizedCommands.description",
        defaultValue: LOCALIZED_COMMANDS_DEFAULT,
    },
    {
        // Applied by the Story scene editor's committed rows (`StoryCommandLineProvider` ->
        // `StoryCommandLineText`): the param key and its `=` are dropped at RENDER time, from the spans
        // `storyCommandHighlight` marks as keys. The projection underneath is untouched, so every value
        // stays click-to-edit and the row still knows which slot it is writing to - and the live field,
        // which is a mirror over a textarea and has to match it character for character, is never
        // affected. Off by default because of the trade it makes: a row carrying two modifiers loses
        // the words that told them apart.
        key: HIDE_PARAM_NAMES_KEY,
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Commands show only parameter values",
        labelKey: "settings.items.hideParamNames.label",
        description: "A more compact reading of the commands in a row.",
        descriptionKey: "settings.items.hideParamNames.description",
        defaultValue: HIDE_PARAM_NAMES_DEFAULT,
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
        description: "Turn this off to quit NarraLeaf Studio instead when no other window is open.",
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
        description: "Applies to projects you haven't decided about. Each project can override it.",
        descriptionKey: "settings.items.dashboardOnOpen.description",
        defaultValue: true,
    },
    {
        // Handled entirely by `clearAllProjectStats`; nothing is stored under this key - it is
        // only the identity of the button. Scoped to every project because the Settings window is
        // its own window and has no current project; the per-project reset lives on the dashboard.
        key: "dashboard.clearAllStats",
        category: "workspace",
        scope: SettingScope.Global,
        type: SettingValueType.Action,
        label: "Clear all statistics data",
        labelKey: "settings.items.clearAllStats.label",
        description: "Erase the writing history, active time, and build history of every project. Counts read from your projects are unaffected.",
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
        description: "The strip along the bottom of the workspace.",
        descriptionKey: "settings.items.statusBarVisible.description",
        defaultValue: true,
    },
    {
        // Read by WorkspaceLayout: drops the title-bar search pill. The palette keeps working -
        // with the box gone it renders its own input inside the candidate card.
        key: "ui.titleBarSearch.visible",
        category: "appearance",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Show title bar search box",
        labelKey: "settings.items.titleBarSearchVisible.label",
        description: "The search box in the middle of the title bar.",
        descriptionKey: "settings.items.titleBarSearchVisible.description",
        defaultValue: true,
    },
    {
        // Nothing is stored under this key - the background's own settings (image, opacity, fill,
        // anchor) are written by the workspace dialog this button opens. Picking a file, previewing
        // the opacity and choosing how it fills the window only make sense together, so they live
        // in one dialog instead of three unrelated rows here. Like `keybindings.open`, the button
        // asks main to reveal the dialog, because it can only exist in a workspace window.
        key: "ui.backgroundImage.configure",
        category: "appearance",
        scope: SettingScope.Global,
        type: SettingValueType.Action,
        label: "Custom background image",
        labelKey: "settings.items.backgroundImage.label",
        description: "Show a picture of your choice behind the workspace.",
        descriptionKey: "settings.items.backgroundImage.description",
        defaultValue: null,
        actionLabel: "Configure…",
        actionLabelKey: "settings.items.backgroundImage.action",
        skipConfirm: true,
        availability: async () => {
            const { getInterface } = await import("@/lib/app/bridge");
            const result = await getInterface().app.countWorkspaceWindows();
            const enabled = result.success && result.data.count > 0;
            return enabled
                ? { enabled: true }
                : { enabled: false, reasonKey: "settings.items.backgroundImage.needsWorkspace" };
        },
        onInvoke: async () => {
            const { getInterface } = await import("@/lib/app/bridge");
            const result = await getInterface().app.requestWorkspaceView("backgroundImage");
            // Only step aside once the workspace has actually been handed the request; if none was
            // open, closing would leave the user with nothing to show for the click.
            if (result.success && result.data.delivered) {
                window.close();
            }
        },
    },
    {
        // The keyboard-shortcut table, rendered inline by `SETTING_PANELS.keybindings`. Nothing is
        // written here by the settings layer - the panel reads and writes this key itself, as one
        // `catalogId -> chord` map, and every open workspace picks the change up through the
        // global-state broadcast (see UIService's keybinding override sync).
        key: KEYBINDING_OVERRIDES_SETTINGS_KEY,
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Custom,
        panel: "keybindings",
        label: "Keyboard shortcuts",
        labelKey: "settings.items.keybindings.label",
        description: "",
        defaultValue: null,
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
        description: "Mirror for downloading Electron. Leave empty to use the official source.",
        descriptionKey: "settings.items.electronMirror.description",
        defaultValue: "",
    },
    {
        // Read by the main process (pluginRegistryClient.resolveRegistryUrl) when the
        // launcher's Plugins store fetches the index or installs a plugin. Empty = the
        // official NarraLeaf/Plugins registry index.
        key: "plugins.registryUrl",
        category: "plugins",
        scope: SettingScope.Global,
        type: SettingValueType.String,
        label: "Registry URL",
        labelKey: "settings.items.pluginRegistryUrl.label",
        description: "Where the plugin store looks. Leave empty to use the official NarraLeaf registry.",
        descriptionKey: "settings.items.pluginRegistryUrl.description",
        defaultValue: "",
    },
    {
        // Read by the main process (uiTemplateRegistryClient.resolveTemplateRegistryUrl)
        // when the UI editor's template store fetches the index or a template bundle.
        // Empty = the official NarraLeaf/UI-Templates registry index.
        key: "uiTemplates.registryUrl",
        category: "plugins",
        scope: SettingScope.Global,
        type: SettingValueType.String,
        label: "UI template registry URL",
        labelKey: "settings.items.uiTemplateRegistryUrl.label",
        description: "Where the template store looks. Leave empty to use the official NarraLeaf registry.",
        descriptionKey: "settings.items.uiTemplateRegistryUrl.description",
        defaultValue: "",
    },
    {
        // Read by the renderer's CheckpointScheduler (VersionControlService) on every
        // beat, so a change here applies without a restart. 0 turns the timer off.
        // Only ever fires when a versioned file has actually been written - never by
        // asking the backend what changed, which is a scan and not a pure read.
        key: "versionControl.checkpointIntervalMinutes",
        category: "sync",
        scope: SettingScope.Global,
        type: SettingValueType.Integer,
        label: "Automatic checkpoint interval",
        labelKey: "settings.items.checkpointInterval.label",
        description: "How long to wait before recording a checkpoint, and only when something changed. Set to 0 to turn them off.",
        descriptionKey: "settings.items.checkpointInterval.description",
        defaultValue: 15,
        min: 0,
        // A day. Past that the setting is indistinguishable from 0, which is the honest
        // way to say "do not do this".
        max: 1440,
        step: 5,
        unit: "min",
    },
    {
        // Directly under the interval because the pair is read together, and separate from it
        // because they answer different questions: the interval is how often to record WHILE
        // working, this is the one moment after which nothing is watching the working tree at
        // all. Read by the main process (App.checkpointBeforeClose) at close time, so a change
        // here applies to the next window closed without a restart.
        key: "versionControl.checkpointOnClose",
        category: "sync",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Record a checkpoint when a workspace closes",
        labelKey: "settings.items.checkpointOnClose.label",
        description: "Records on closing the window, independent of the interval above.",
        descriptionKey: "settings.items.checkpointOnClose.description",
        defaultValue: true,
    },
    {
        // Read by the main process (VcsManager.resolveIdentity) for every commit and
        // checkpoint. Empty records UNCONFIGURED_IDENTITY; deliberately not the OS
        // account name, which is not Studio's to publish on the author's behalf.
        key: "versionControl.authorName",
        category: "sync",
        scope: SettingScope.Global,
        type: SettingValueType.String,
        label: "Author name",
        labelKey: "settings.items.versionControlAuthor.label",
        description: "Recorded on commits and checkpoints. Leave empty to record NarraLeaf Studio instead.",
        descriptionKey: "settings.items.versionControlAuthor.description",
        defaultValue: "",
    },
    {
        // Folded into the name by `composeVcsIdentity` before it reaches Lore, which stores ONE
        // identity string - so this is not a field the repository keeps apart, it is the
        // `Name <email>` half every other version-control tool writes. Not validated: an address
        // that is wrong in a way a regex would catch is still the author's to fix, and refusing
        // to record because of it would block committing rather than help.
        key: "versionControl.authorEmail",
        category: "sync",
        scope: SettingScope.Global,
        type: SettingValueType.String,
        label: "Author email",
        labelKey: "settings.items.versionControlAuthorEmail.label",
        description: "Recorded next to the author name, as \"Name <email>\". Leave empty to record no address.",
        descriptionKey: "settings.items.versionControlAuthorEmail.description",
        defaultValue: "",
    },
];
