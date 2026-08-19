import { AppSettingDefinition, SettingCategory, SettingScope } from "@/lib/settings/models";
import { SettingValueType } from "@/lib/settings/types";
import {
    EDITOR_FONT_FAMILY_DEFAULT,
    EDITOR_FONT_FAMILY_PRESETS,
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
    STORY_ROW_HIGHLIGHT_DEFAULT,
    STORY_ROW_HIGHLIGHT_KEY,
    STORY_ROW_HIGHLIGHT_OPTIONS,
} from "@/lib/settings/storyRowHighlightOptions";
import {
    SPELLCHECK_FOLLOW_PROJECT,
    SPELLCHECK_LANGUAGE_DEFAULT,
    SPELLCHECK_LANGUAGE_KEY,
    SPELLCHECK_OFF,
} from "@shared/types/spellcheck";
import {
    DETACHED_EDITOR_ON_CLOSE_DEFAULT,
    DETACHED_EDITOR_ON_CLOSE_KEY,
    DETACHED_EDITOR_ON_CLOSE_OPTIONS,
} from "@/lib/settings/detachedEditorCloseOptions";
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
import { CONFIRM_QUIT_DEFAULT, CONFIRM_QUIT_KEY } from "@shared/constants/quit";
import { LOCALE_META, SUPPORTED_LOCALES } from "@shared/i18n";
import { deviceDefaultLocale } from "@/lib/i18n/deviceLocale";
import { clearAllProjectStats } from "@/lib/stats/clearAllProjectStats";
import { resetAllPreferences, resetWorkspaceLayout } from "@/lib/settings/resetSettings";
import { DASHBOARD_OPEN_DEFAULT_KEY } from "@shared/constants/dashboard";
import { SERVERS_PANEL_SETTING_KEY } from "@shared/constants/servers";
import { UPDATE_AUTO_CHECK_KEY, UPDATE_PANEL_SETTING_KEY } from "@shared/constants/update";
import { KEYBINDING_OVERRIDES_SETTINGS_KEY } from "@/lib/workspace/services/ui/KeybindingService";
import { DOWNLOAD_REWRITES_KEY } from "@shared/types/downloadSource";
import { OFFICIAL_SOURCE_VALUE } from "@/lib/settings/sourceSelection";
import { MIRROR_PLUGIN_REGISTRY_URL } from "@shared/constants/pluginRegistry";
import {
    EDITOR_LINE_NUMBERS_DEFAULT,
    EDITOR_LINE_NUMBERS_KEY,
    EDITOR_SOFT_WRAP_DEFAULT,
    EDITOR_SOFT_WRAP_KEY,
} from "@/lib/settings/textEditorOptions";
import {
    RECENT_PROJECTS_LIMIT_DEFAULT,
    RECENT_PROJECTS_LIMIT_MAX,
    RECENT_PROJECTS_LIMIT_MIN,
} from "@shared/constants/recentProjects";
import { DEVELOPER_MODE_DEFAULT, DEVELOPER_MODE_KEY } from "@/lib/developer";
import {
    TOOLTIP_DELAY_DEFAULT_MS,
    TOOLTIP_DELAY_KEY,
    TOOLTIP_DELAY_MAX_MS,
    TOOLTIP_DELAY_MIN_MS,
    TOOLTIP_DELAY_STEP_MS,
} from "@/lib/settings/tooltipOptions";

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
        // Its own category rather than a panel filed under Editor: shortcuts reach every surface in
        // Studio, not just the editors, and nobody looking for them thought to open Editor first.
        key: "shortcuts",
        label: "Shortcuts",
        labelKey: "settings.categories.shortcuts.label",
        description: "Keys bound to each command throughout Studio.",
        descriptionKey: "settings.categories.shortcuts.description",
        order: 4,
    },
    {
        // Was "Sync", whose description promised a backup cadence that was never implemented; the
        // keys behind that promise are gone (RETIRED_GLOBAL_STATE_KEYS) and what is left here is
        // version control, so the category now says so.
        key: "versionControl",
        label: "Version control",
        labelKey: "settings.categories.versionControl.label",
        description: "Checkpoints and the identity recorded on them.",
        descriptionKey: "settings.categories.versionControl.description",
        order: 5,
    },
    {
        // Its own category rather than a panel under Version control: a server is signed in to
        // once and then serves every project pointed at it, so it outlives any of them. Filing
        // it under version control would say the opposite - that it is a property of a project.
        key: "servers",
        label: "Servers",
        labelKey: "settings.categories.servers.label",
        description: "Servers this installation is signed in to, and the accounts it uses.",
        descriptionKey: "settings.categories.servers.description",
        order: 6,
    },
    {
        // Absorbed the former "Plugins" and "Advanced" categories, which between them held four
        // mirror URLs kept apart by which feature happened to need them. Where Studio downloads
        // from is one question, so it is one place.
        key: "network",
        label: "Network",
        labelKey: "settings.categories.network.label",
        description: "Where Studio downloads plugins, templates and build tooling from.",
        descriptionKey: "settings.categories.network.description",
        order: 7,
    },
    {
        key: "data",
        label: "Data",
        labelKey: "settings.categories.data.label",
        description: "Cached files, resetting preferences, and moving them between machines.",
        descriptionKey: "settings.categories.data.description",
        order: 8,
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
        // The device's language, not a fixed "en": this row has to show what an unset key
        // actually resolves to, and both the i18n bootstrap and the main process resolve it
        // through the same device-preference walk. See `lib/i18n/deviceLocale`.
        defaultValue: deviceDefaultLocale(),
        options: [...SUPPORTED_LOCALES],
        optionLabels: Object.fromEntries(
            SUPPORTED_LOCALES.map((code) => [code, LOCALE_META[code].nativeName]),
        ),
    },
    {
        // Read by `lib/developer`, whose store every context menu consults as it is assembled: with
        // this on, a menu grows a final section that copies the identifier of whatever was
        // right-clicked. Nothing else in Studio reads it - it is not a mode the app runs in, and in
        // particular it is not Dev Mode, which runs the game. Kept in General rather than behind an
        // "Advanced" category, because a preference nobody can find is one that gets asked for again.
        key: DEVELOPER_MODE_KEY,
        category: "general",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Developer options",
        labelKey: "settings.items.developerMode.label",
        description: "Right-click menus gain a section for copying the ID of what you clicked.",
        descriptionKey: "settings.items.developerMode.description",
        defaultValue: DEVELOPER_MODE_DEFAULT,
    },
    {
        // Applied by the main process (`ConfirmQuitManager`), which is the only place the keystroke
        // can be seen at all: ⌘Q reaches Studio as the App menu's key equivalent, and swallowing it
        // has to happen before the menu acts on it.
        //
        // macOS only, and the platform check is the whole of the availability rule - there is no
        // state anywhere else that could make it true, so unlike the background-image row this one
        // never changes answer for the lifetime of the window.
        key: CONFIRM_QUIT_KEY,
        category: "general",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Confirm before quitting with ⌘Q",
        labelKey: "settings.items.confirmQuit.label",
        description: "⌘Q quits when it is pressed twice in a row. A single press does nothing.",
        descriptionKey: "settings.items.confirmQuit.description",
        defaultValue: CONFIRM_QUIT_DEFAULT,
        availability: async () => {
            // Dynamic, like the background-image row below: `platform` reaches the window bootstrap
            // for its cached answer, and this module is also loaded by the settings export/import
            // scope walker, which runs where no window has booted.
            const { isMacPlatform } = await import("@/lib/app/platform");
            return isMacPlatform()
                ? { enabled: true }
                : { enabled: false, reasonKey: "settings.items.confirmQuit.unsupportedPlatform" };
        },
    },
    {
        // Read by the main process's UpdateManager when it decides whether to schedule the launch
        // check. Off means Studio never asks on its own; the Check button in the panel below and
        // the tray's Check for Updates row still work, so this turns off the *asking*, not the
        // feature.
        key: UPDATE_AUTO_CHECK_KEY,
        category: "general",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Check for updates at launch",
        labelKey: "update.setting.checkOnLaunch.label",
        description: "Asks GitHub once, shortly after Studio starts. Downloads never begin on their own.",
        descriptionKey: "update.setting.checkOnLaunch.description",
        defaultValue: true,
    },
    {
        // Rendered by `SETTING_PANELS.softwareUpdate`. Nothing is stored under this key: the state
        // it draws lives in the main process (UpdateManager) and arrives pushed, so the progress
        // bar is the downloader's own byte counts rather than an animation.
        //
        // This key is also the `highlight` that opens Settings here - the notification's action
        // and the tray's Check for Updates row both send it (`UPDATE_PANEL_SETTING_KEY`).
        key: UPDATE_PANEL_SETTING_KEY,
        category: "general",
        scope: SettingScope.Global,
        type: SettingValueType.Custom,
        panel: "softwareUpdate",
        label: "Updates",
        labelKey: "update.title",
        description: "",
        defaultValue: null,
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
        // Handed to the tooltip controller by `lib/appearance`, which is also where the accent and
        // the motion preference are applied: a value JS has to read, with no media query or CSS
        // custom property that could carry it instead.
        key: TOOLTIP_DELAY_KEY,
        category: "appearance",
        scope: SettingScope.Global,
        type: SettingValueType.Integer,
        label: "Tooltip delay",
        labelKey: "settings.items.tooltipDelay.label",
        description: "How long the pointer rests on a control before its tooltip appears. Within a toolbar the wait applies to the first tooltip only.",
        descriptionKey: "settings.items.tooltipDelay.description",
        defaultValue: TOOLTIP_DELAY_DEFAULT_MS,
        min: TOOLTIP_DELAY_MIN_MS,
        max: TOOLTIP_DELAY_MAX_MS,
        step: TOOLTIP_DELAY_STEP_MS,
        unit: "ms",
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
        //
        // `Font`, not `Enum`: the list is the presets below PLUS every family installed on this
        // computer, which the picker discovers at open time. `options` therefore carries only the
        // presets - what the stored value may be is any family name, so nothing validates against
        // this list (see `editorFontCssFamily`, which is what actually has to accept it).
        key: "editor.fontFamily",
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Font,
        label: "Story editor font",
        labelKey: "settings.items.editorFontFamily.label",
        description: "Typeface used for story text in the scene editor. Any font installed on this computer can be chosen.",
        descriptionKey: "settings.items.editorFontFamily.description",
        defaultValue: EDITOR_FONT_FAMILY_DEFAULT,
        options: [...EDITOR_FONT_FAMILY_PRESETS],
        optionLabelKeys: {
            "Default": "settings.items.editorFontFamily.options.default",
            "Sans Serif": "settings.items.editorFontFamily.options.sansSerif",
            "Serif": "settings.items.editorFontFamily.options.serif",
            "Monospace": "settings.items.editorFontFamily.options.monospace",
        },
    },
    {
        // Applied by the built-in text editor (`TextEditor` -> Monaco `lineNumbers`). The key
        // shipped a default long before anything read it; it is wired rather than retired
        // because the editor it describes exists. Live: the editor is never re-created for a
        // settings change, which would take the undo stack with it.
        key: EDITOR_LINE_NUMBERS_KEY,
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Show line numbers",
        labelKey: "settings.items.editorLineNumbers.label",
        description: "In the built-in text editor, for files opened from the asset library.",
        descriptionKey: "settings.items.editorLineNumbers.description",
        defaultValue: EDITOR_LINE_NUMBERS_DEFAULT,
    },
    {
        // Applied by the built-in text editor (`TextEditor` -> Monaco `wordWrap`), same story
        // as the line-number gutter above.
        key: EDITOR_SOFT_WRAP_KEY,
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Boolean,
        label: "Wrap long lines",
        labelKey: "settings.items.editorSoftWrap.label",
        description: "Wrap instead of scrolling sideways in the built-in text editor.",
        descriptionKey: "settings.items.editorSoftWrap.description",
        defaultValue: EDITOR_SOFT_WRAP_DEFAULT,
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
        // Applied by the Story scene editor's rows (`StoryBlockRow`, through `useStoryRowHighlight`):
        // the chosen layer gets a `fill-subtle` wash behind the whole row. It changes nothing about
        // what a row IS - the gutter mark is what says whether a line gets performed, on every row and
        // in every mode - so this is a reading aid and is off by default. Which half to paint depends
        // on what the author is doing rather than on the document: highlighting the script suits
        // writing, highlighting the directives suits staging.
        key: STORY_ROW_HIGHLIGHT_KEY,
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Enum,
        label: "Highlight story rows",
        labelKey: "settings.items.storyRowHighlight.label",
        description: "Give one kind of row a background tint, so it separates from the rest at a glance.",
        descriptionKey: "settings.items.storyRowHighlight.description",
        defaultValue: STORY_ROW_HIGHLIGHT_DEFAULT,
        options: [...STORY_ROW_HIGHLIGHT_OPTIONS],
        optionLabelKeys: {
            none: "settings.items.storyRowHighlight.options.none",
            script: "settings.items.storyRowHighlight.options.script",
            command: "settings.items.storyRowHighlight.options.command",
        },
    },
    {
        /**
         * Applied by `DictionaryService`, which sends the project's source language and its own
         * words to the main process; main turns the pair into the language it checks in
         * (`@shared/types/spellcheck`). Only the story script is checked - translations are somebody
         * else's language and not the author's to respell.
         *
         * The option list is finished at render time from the dictionaries actually installed on
         * this machine. It has to be, because that list is not a fact this module can know: it is
         * whatever the author has downloaded, and hard-coding it here would offer a language
         * nothing can be checked against.
         */
        key: SPELLCHECK_LANGUAGE_KEY,
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Enum,
        label: "Spellcheck language",
        labelKey: "settings.items.spellcheckLanguage.label",
        description: "Marks misspellings in the story script. Translations are never checked.",
        descriptionKey: "settings.items.spellcheckLanguage.description",
        defaultValue: SPELLCHECK_LANGUAGE_DEFAULT,
        options: [SPELLCHECK_FOLLOW_PROJECT, SPELLCHECK_OFF],
        optionLabelKeys: {
            [SPELLCHECK_FOLLOW_PROJECT]: "settings.items.spellcheckLanguage.options.followProject",
            [SPELLCHECK_OFF]: "settings.items.spellcheckLanguage.options.off",
        },
        /**
         * Enabled, and carrying a reason anyway.
         *
         * No dictionary covers the project's own language: either the author has not downloaded
         * one, or - for Chinese and Japanese - none exists, since neither language has spelling in
         * the word-list sense. Either way, following the project's language checks nothing. The row
         * says so instead of leaving a control that looks live and produces not one underline. It
         * stays usable because naming a language outright is still a real choice, and a control
         * closed for the length of a project is worse than a control that explains itself.
         */
        availability: async () => {
            const { getInterface } = await import("@/lib/app/bridge");
            const { projectLanguageHasNoDictionary } = await import("@shared/types/spellcheck");
            const result = await getInterface().app.spellcheck.getStatus();
            return result.success && projectLanguageHasNoDictionary(result.data)
                ? { enabled: true, reasonKey: "settings.items.spellcheckLanguage.noDictionary" as const }
                : { enabled: true };
        },
    },
    {
        // Rendered by `SETTING_PANELS.dictionaries`. Nothing is stored under this key: the
        // dictionaries are files in a cache the main process owns, and the panel lists them,
        // fetches them and deletes them over IPC.
        //
        // Beneath the language row rather than folded into it, because the two answer different
        // questions. The row above asks which language THIS PROJECT is checked in; this asks which
        // languages the machine can check at all - a fact every project on it shares, and the reason
        // the row above can have nothing to offer.
        key: "editor.dictionaries",
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Custom,
        panel: "dictionaries",
        label: "Spelling dictionaries",
        labelKey: "settings.items.dictionaries.label",
        description: "",
        defaultValue: null,
    },
    {
        // Read by the workspace's detached-editor host when a popped-out window goes away. An
        // editor can be popped out of its tab into a window of its own (the blueprint editor's
        // title row offers it, and a middle click there does the same); this decides whether
        // closing that window hands the editor back to the workspace or ends it.
        key: DETACHED_EDITOR_ON_CLOSE_KEY,
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Enum,
        label: "When a detached editor window closes",
        labelKey: "settings.items.detachedEditorOnClose.label",
        description: "An editor opened in its own window either returns to the workspace or closes with the window.",
        descriptionKey: "settings.items.detachedEditorOnClose.description",
        defaultValue: DETACHED_EDITOR_ON_CLOSE_DEFAULT,
        options: [...DETACHED_EDITOR_ON_CLOSE_OPTIONS],
        optionLabelKeys: {
            restoreTab: "settings.items.detachedEditorOnClose.options.restoreTab",
            close: "settings.items.detachedEditorOnClose.options.close",
        },
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
        // Read by the main process (`RecentlyOpened.limit`) every time the history is written, so
        // shortening it takes effect on the next project opened rather than retroactively. Has
        // been honored since the history existed and simply had no control anywhere.
        key: "workspace.recentProjectsLimit",
        category: "workspace",
        scope: SettingScope.Global,
        type: SettingValueType.Integer,
        label: "Recent projects to remember",
        labelKey: "settings.items.recentProjectsLimit.label",
        description: "How many projects the home screen and the Open Recent menu keep.",
        descriptionKey: "settings.items.recentProjectsLimit.description",
        defaultValue: RECENT_PROJECTS_LIMIT_DEFAULT,
        min: RECENT_PROJECTS_LIMIT_MIN,
        max: RECENT_PROJECTS_LIMIT_MAX,
        step: 1,
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
        // Rendered by `SETTING_PANELS.servers`. Nothing is stored under this key: the servers
        // themselves are in `versionControl.serverSessions`, written by the main process when a
        // sign-in succeeds, and the panel reads them over IPC rather than out of the store so
        // that a session the backend has since dropped is not drawn as one that is in force.
        //
        // This key is also the `highlight` that opens Settings here, which is what the version
        // rail's server dialog sends (`SERVERS_PANEL_SETTING_KEY`).
        key: SERVERS_PANEL_SETTING_KEY,
        category: "servers",
        scope: SettingScope.Global,
        type: SettingValueType.Custom,
        panel: "servers",
        label: "Servers",
        labelKey: "settings.items.servers.label",
        description: "",
        defaultValue: null,
    },
    {
        // Rendered by `SETTING_PANELS.cacheInventory`. Nothing is stored under this key; the panel
        // measures the buckets over IPC and clears them the same way.
        key: "data.cache",
        category: "data",
        scope: SettingScope.Global,
        type: SettingValueType.Custom,
        panel: "cacheInventory",
        label: "Cached files",
        labelKey: "settings.items.cacheInventory.label",
        description: "",
        defaultValue: null,
    },
    {
        // Rendered by `SETTING_PANELS.settingsTransfer`: export with its two opt-ins, and import
        // with the preview that has to come before anything is written.
        key: "data.transfer",
        category: "data",
        scope: SettingScope.Global,
        type: SettingValueType.Custom,
        panel: "settingsTransfer",
        label: "Move settings between machines",
        labelKey: "settings.items.settingsTransfer.label",
        description: "",
        defaultValue: null,
    },
    {
        // Deletes the workspace's shape keys, read out of the store because the per-project ones
        // (`ui.editor.session.project.<id>`) exist nowhere else. Separate from the preferences
        // reset below on purpose - see `resetSettings`.
        key: "data.resetWorkspaceLayout",
        category: "data",
        scope: SettingScope.Global,
        type: SettingValueType.Action,
        label: "Reset the workspace layout",
        labelKey: "settings.items.resetWorkspaceLayout.label",
        description: "Put the panels, sidebars and open editor tabs back to how they start. Your projects are not touched.",
        descriptionKey: "settings.items.resetWorkspaceLayout.description",
        defaultValue: null,
        actionLabel: "Reset",
        actionLabelKey: "settings.items.resetWorkspaceLayout.action",
        confirmLabelKey: "settings.items.resetWorkspaceLayout.confirm",
        onInvoke: resetWorkspaceLayout,
    },
    {
        // Deletes every preference key this build has. The project history and the per-project
        // statistics are refused by the main process, so this cannot take them with it.
        key: "data.resetAllPreferences",
        category: "data",
        scope: SettingScope.Global,
        type: SettingValueType.Action,
        label: "Reset all settings",
        labelKey: "settings.items.resetAllPreferences.label",
        description: "Put every setting back to its default. Your projects, their history and your statistics are not touched.",
        descriptionKey: "settings.items.resetAllPreferences.description",
        defaultValue: null,
        actionLabel: "Reset",
        actionLabelKey: "settings.items.resetAllPreferences.action",
        confirmLabelKey: "settings.items.resetAllPreferences.confirm",
        danger: true,
        onInvoke: resetAllPreferences,
    },
    {
        // Handled entirely by `clearAllProjectStats`; nothing is stored under this key - it is
        // only the identity of the button. Scoped to every project because the Settings window is
        // its own window and has no current project; the per-project reset lives on the dashboard.
        key: "dashboard.clearAllStats",
        category: "data",
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
        category: "shortcuts",
        scope: SettingScope.Global,
        type: SettingValueType.Custom,
        panel: "keybindings",
        label: "Keyboard shortcuts",
        labelKey: "settings.items.keybindings.label",
        description: "",
        defaultValue: null,
    },
    {
        // Read by the main process (pluginRegistryClient.resolveRegistryUrl) when the
        // launcher's Plugins store fetches the index or installs a plugin. Empty = the
        // official NarraLeaf/Plugins registry index.
        //
        // Note what this does NOT cover, and why the rewrite table below exists: the index
        // it fetches carries an absolute `release.download` URL per plugin, so pointing
        // this at a mirror mirrors the catalogue and leaves Install going to github.com.
        key: "plugins.registryUrl",
        category: "network",
        scope: SettingScope.Global,
        type: SettingValueType.Source,
        label: "Plugin registry URL",
        labelKey: "settings.items.pluginRegistryUrl.label",
        description: "Where the plugin store looks for its index.",
        descriptionKey: "settings.items.pluginRegistryUrl.description",
        defaultValue: "",
        // The official entry stores "", which is what makes it the default without this list
        // having to name the official address; see `OFFICIAL_SOURCE_VALUE`.
        options: [OFFICIAL_SOURCE_VALUE, MIRROR_PLUGIN_REGISTRY_URL],
        optionLabelKeys: {
            [OFFICIAL_SOURCE_VALUE]: "settings.source.official",
            [MIRROR_PLUGIN_REGISTRY_URL]: "settings.source.chinaMirror",
        },
    },
    {
        // Read by the main process (uiTemplateRegistryClient.resolveTemplateRegistryUrl)
        // when the UI editor's template store fetches the index or a template bundle.
        // Empty = the official NarraLeaf/UI-Templates registry index. This key reaches
        // further than the plugin one: a template's files resolve against the index's own
        // directory (registryBaseDir), so they follow it wherever it points - which is why
        // no mirror is offered by name here. See uiTemplateRegistry.ts for the measurement.
        key: "uiTemplates.registryUrl",
        category: "network",
        scope: SettingScope.Global,
        type: SettingValueType.Source,
        label: "UI template registry URL",
        labelKey: "settings.items.uiTemplateRegistryUrl.label",
        description: "Where the template store looks for its index.",
        descriptionKey: "settings.items.uiTemplateRegistryUrl.description",
        defaultValue: "",
        options: [OFFICIAL_SOURCE_VALUE],
        optionLabelKeys: {
            [OFFICIAL_SOURCE_VALUE]: "settings.source.official",
        },
    },
    {
        // Read by the main-process GameBuildManager (readElectronMirror) and
        // passed to electron-builder as electronDownload.mirror for cross-platform
        // game builds. Empty = official Electron download source.
        key: "build.electronMirror",
        category: "network",
        scope: SettingScope.Global,
        type: SettingValueType.Source,
        label: "Electron download mirror",
        labelKey: "settings.items.electronMirror.label",
        description: "Mirror for downloading Electron.",
        descriptionKey: "settings.items.electronMirror.description",
        defaultValue: "",
        // Official or typed, with no mirror in between: the two registries above have one
        // community mirror each that we can name, and there is no equivalent for these binaries
        // that Studio can vouch for. An address offered by name reads as endorsed.
        options: [OFFICIAL_SOURCE_VALUE],
        optionLabelKeys: {
            [OFFICIAL_SOURCE_VALUE]: "settings.source.noMirror",
        },
    },
    {
        // Read by the build worker (winCodeSignCache.binariesMirror), ahead of the two
        // environment variables it already honored. A second field rather than a mode of
        // the one above because the URL layouts differ - the comment in GameBuildManager
        // spelled out why one cannot be synthesized from the other, and until now the
        // answer was that a Studio user simply had no way to set it.
        key: "build.electronBuilderBinariesMirror",
        category: "network",
        scope: SettingScope.Global,
        type: SettingValueType.Source,
        label: "Build tooling mirror",
        labelKey: "settings.items.electronBuilderBinariesMirror.label",
        description: "Mirror for the installer tooling a build downloads (NSIS, AppImage, code-signing helpers).",
        descriptionKey: "settings.items.electronBuilderBinariesMirror.description",
        defaultValue: "",
        options: [OFFICIAL_SOURCE_VALUE],
        optionLabelKeys: {
            [OFFICIAL_SOURCE_VALUE]: "settings.source.noMirror",
        },
    },
    {
        // The rewrite table (see @shared/utils/downloadSource). Rendered by its own panel:
        // an ordered list of rules is not a value the generic control layer can edit, and
        // the panel owns reading and writing this key exactly as the keybindings panel does.
        key: DOWNLOAD_REWRITES_KEY,
        category: "network",
        scope: SettingScope.Global,
        type: SettingValueType.Custom,
        panel: "downloadSources",
        label: "Download address rewrites",
        labelKey: "settings.items.downloadRewrites.label",
        description: "",
        defaultValue: null,
    },
    {
        // Read by the renderer's CheckpointScheduler (VersionControlService) on every
        // beat, so a change here applies without a restart. 0 turns the timer off.
        // Only ever fires when a versioned file has actually been written - never by
        // asking the backend what changed, which is a scan and not a pure read.
        key: "versionControl.checkpointIntervalMinutes",
        category: "versionControl",
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
        category: "versionControl",
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
        category: "versionControl",
        scope: SettingScope.Global,
        type: SettingValueType.String,
        label: "Author name",
        labelKey: "settings.items.versionControlAuthor.label",
        description: "Recorded on commits and checkpoints. Leave empty to record NarraLeaf Studio instead.",
        descriptionKey: "settings.items.versionControlAuthor.description",
        defaultValue: "",
        /**
         * Read-only while this installation is signed in to a server.
         *
         * The point of signing in is that a team's history says who actually made each
         * revision rather than what each person typed here, so while a session is in force
         * the name on a revision comes from the token and this field is not what is
         * recorded. Left editable it would be a box that accepts a name and changes
         * nothing - which is worse than one that says why it is closed.
         *
         * The setting itself stays, and so does everything that reads it: a project with no
         * server has no token to take a name from, and that is the case this exists for.
         */
        availability: async () => {
            const { getInterface } = await import("@/lib/app/bridge");
            const result = await getInterface().app.state.getGlobalState("versionControl.serverSessions");
            const sessions = result.success && Array.isArray(result.data.value) ? result.data.value : [];
            return sessions.length === 0
                ? { enabled: true }
                : { enabled: false, reasonKey: "settings.items.versionControlAuthor.fromServer" as const };
        },

    },
    {
        // Folded into the name by `composeVcsIdentity` before it reaches Lore, which stores ONE
        // identity string - so this is not a field the repository keeps apart, it is the
        // `Name <email>` half every other version-control tool writes. Not validated: an address
        // that is wrong in a way a regex would catch is still the author's to fix, and refusing
        // to record because of it would block committing rather than help.
        key: "versionControl.authorEmail",
        category: "versionControl",
        scope: SettingScope.Global,
        type: SettingValueType.String,
        label: "Author email",
        labelKey: "settings.items.versionControlAuthorEmail.label",
        description: "Recorded next to the author name, as \"Name <email>\". Leave empty to record no address.",
        descriptionKey: "settings.items.versionControlAuthorEmail.description",
        defaultValue: "",
        /**
         * Read-only while this installation is signed in to a server.
         *
         * The point of signing in is that a team's history says who actually made each
         * revision rather than what each person typed here, so while a session is in force
         * the name on a revision comes from the token and this field is not what is
         * recorded. Left editable it would be a box that accepts a name and changes
         * nothing - which is worse than one that says why it is closed.
         *
         * The setting itself stays, and so does everything that reads it: a project with no
         * server has no token to take a name from, and that is the case this exists for.
         */
        availability: async () => {
            const { getInterface } = await import("@/lib/app/bridge");
            const result = await getInterface().app.state.getGlobalState("versionControl.serverSessions");
            const sessions = result.success && Array.isArray(result.data.value) ? result.data.value : [];
            return sessions.length === 0
                ? { enabled: true }
                : { enabled: false, reasonKey: "settings.items.versionControlAuthor.fromServer" as const };
        },

    },
];
