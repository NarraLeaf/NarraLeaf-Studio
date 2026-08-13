import { ACCENT_COLOR_DEFAULT } from "@shared/constants/accent";
import { ZOOM_PERCENT_DEFAULT } from "@shared/constants/zoom";
import { DownloadRewriteRule } from "@shared/types/downloadSource";
import { PersistentState } from "@shared/utils/persistentState";
import type { VcsServerSession } from "@shared/types/vcs";
import { RecentlyOpenedProject } from "./appStateTypes";

export interface GlobalStateType extends Record<string, any> {
    "app.recentProjects": RecentlyOpenedProject[];
    /**
     * Interface language, as a locale code; absent until someone chooses one.
     *
     * Deliberately absent from `GLOBAL_STATE_DEFAULTS` (like `editor.slashAtAlias` and the
     * `ui.background*` keys): the right answer for an unset value depends on the machine, which a
     * static default cannot know. Both processes resolve absence through `resolvePreferredLocale`
     * against their own view of the system languages - the renderer's `deviceDefaultLocale`, the
     * main process's `getMainLocale`. A stored value always wins.
     */
    "app.language": string;
    /**
     * Which revision of first-run setup this installation has completed; absent until it has.
     *
     * Installation state rather than a preference, which is why it has no settings row and no
     * entry in `GLOBAL_STATE_DEFAULTS` - see `@shared/constants/onboarding` for what both of
     * those absences buy.
     */
    "app.onboardingVersion": number;
    /**
     * Developer options: context menus grow a section that copies the identifier of whatever was
     * right-clicked (a page, an element, an asset, a character, a scene, a row).
     *
     * Not a mode the app runs in, despite the name an author would reach for - nothing about how a
     * project loads, saves, builds or plays changes. It only decides whether identifiers, which are
     * the app's own bookkeeping rather than anything an author writes, are offered for copying. Kept
     * distinct in the interface from Dev Mode (`ui.runMode`), which runs the game.
     */
    "app.developerMode": boolean;
    /**
     * Whether Studio asks GitHub for a newer release shortly after launch.
     *
     * Deliberately *not* the old `app.autoCheckUpdates`, which is in `RETIRED_GLOBAL_STATE_KEYS`
     * and swept from every profile on start-up: reusing that name would make the sweeper delete
     * the author's answer on the next launch. See `@shared/constants/update`.
     */
    "app.updateCheckOnLaunch": boolean;
    /**
     * Whether this profile has been told that Studio keeps running after its last window closes.
     *
     * Installation state rather than a preference, like `app.onboardingVersion`: it has no
     * settings row and deliberately no entry in `GLOBAL_STATE_DEFAULTS`, because absence is what
     * makes the notice show. See `@shared/constants/update`.
     */
    "app.trayResidencyNoticeShown": boolean;
    "ui.themeMode": "auto" | "light" | "dark" | string;
    /**
     * Which mode the toolbar's Run split-button launches — Dev Mode or Preview. The button runs the
     * selected mode; its dropdown switches this. A UI habit, so it lives globally rather than per
     * project.
     */
    "ui.runMode": "devMode" | "preview" | string;
    /** Studio UI zoom as a whole percentage; see @shared/constants/zoom. */
    "ui.zoomPercent": number;
    /**
     * Accent preset id from @shared/constants/accent — not a free color. Applied by the renderer
     * (lib/appearance) by overriding the `--nl-primary` channels, which every `*-primary` utility
     * resolves through. Studio windows only; a shipped game keeps the brand anchor.
     */
    "ui.accentColor": string;
    /**
     * Calm the Studio interface: no CSS transitions or animations (styles.css) and no
     * framer-motion transform/layout animations (the MotionConfig in lib/renderApp). Independent
     * of the OS-level `prefers-reduced-motion`, which is honored on its own — this is for wanting
     * it here without wanting it everywhere. Game content is exempt in both layers.
     */
    "ui.reduceMotion": boolean;
    /** The slim strip along the bottom of the workspace; the dock reclaims its row when off. */
    "ui.statusBar.visible": boolean;
    /**
     * Status bar entries the user switched off, as one list of registry ids. Hidden-by-id rather
     * than shown-by-id so entries added in a later release start visible without a migration; one
     * key rather than one per entry because entry ids contain dots the settings store would split.
     */
    "ui.statusBar.hiddenItems": string[];
    /** The search pill in the title bar. With it hidden the command palette grows its own input. */
    "ui.titleBarSearch.visible": boolean;
    /**
     * Watermark background. `ui.backgroundImage` is a *file name* inside the userData/backgrounds
     * cache, never a path - the main process resolves it by basename so a renderer cannot steer
     * the read at arbitrary files. The name is `<content hash>.<ext>`, so picking a different
     * picture always changes this value and every window notices. Null (or absent) means no
     * background, which is what disables the layer.
     */
    "ui.backgroundImage": string | null;
    /** Watermark strength, as a percentage; clamped to 2–40 when read. */
    "ui.backgroundOpacity": number;
    "ui.backgroundFill": "cover" | "contain" | "tile" | "center" | string;
    /** CSS `background-position` keyword pair, e.g. "center center". */
    "ui.backgroundAnchor": string;
    /** Blur radius in CSS pixels; 0 (the default) leaves the picture sharp. Clamped to 0–40. */
    "ui.backgroundBlur": number;
    /**
     * User keybinding rebinds as one `catalogId -> chord` map. One key rather than one key per
     * binding because catalog ids contain dots, which the dotted-path settings store would split
     * into nested objects.
     */
    "keybindings.overrides": Record<string, string>;
    "editor.fontSize": number;
    "editor.fontFamily": string;
    /** Show the line-number gutter in the built-in text editor (assets, scripts, plain files). */
    "editor.lineNumbers": boolean;
    /** Wrap long lines in the built-in text editor instead of scrolling horizontally. */
    "editor.softWrap": boolean;
    /**
     * Opacity (0-100) of the editor's reading surfaces — story prose area, inspector field area,
     * Dev Mode debug panel. Published as `--nl-editor-surface-opacity` by lib/appearance; see
     * lib/settings/editorSurfaceOptions. 100 (fully opaque) is the default and a no-op without a
     * workspace wallpaper, which is the only thing an opaque plate can cut a seam into.
     */
    "editor.surfaceOpacity": number;
    "editor.maxActiveEditors": number;
    /**
     * Let "@" stand in for "/" as the trigger that opens the story editor's action creator.
     *
     * A Simplified-Chinese input method rewrites the "/" key as "、", so authors typing in Chinese
     * have to switch IME just to start a command; "@" survives that mapping untouched. Deliberately
     * absent from GLOBAL_STATE_DEFAULTS (like the `ui.background*` keys): the default is device-locale
     * dependent, so the renderer resolves an unset value through `slashAtAliasDefault()` — on for a
     * Simplified-Chinese device, off otherwise — rather than a static default that cannot know the
     * locale. A value written here (the user toggled it) is honored as-is.
     */
    "editor.slashAtAlias": boolean;
    /**
     * Whether the story editor's command vocabulary — command names, their categories, parameter
     * names and the inline ghost hint — follows the interface language. Off keeps it in English.
     *
     * A second language axis rather than a reuse of `app.language`, because the two answer different
     * questions. The interface language is "what language do I read"; this is "what language is the
     * grammar I type", and authors working from English tutorials routinely want English commands
     * behind a Chinese interface. On by default, so nobody who does not care ever meets the
     * distinction. Resolved through `resolveCommandLocale` in lib/settings/commandLanguageOptions.
     */
    "editor.localizedCommands": boolean;
    /**
     * Whether a committed story row prints only the VALUES of its modifiers — `@hide Anyo fade` in
     * place of `@hide Anyo t=fade`.
     *
     * A display setting for the committed row alone: the line being typed still shows what is being
     * typed, and the projection underneath is unchanged, so nothing about what the row means or how it
     * is edited moves. Off by default, because the keys are what disambiguate a row that carries more
     * than one modifier. See lib/settings/commandParamNameOptions.
     */
    "editor.hideParamNames": boolean;
    /**
     * Which of the story editor's two layers (gutter 规范 §1) wears a background tint: the script, the
     * directives, or neither.
     *
     * Purely a reading aid — the layers exist whether or not they are painted, and the gutter's mark
     * says which one a row is in on every row regardless. `"none"` by default, because on a
     * script-heavy scene the tint repeats what the mark already said. See
     * lib/settings/storyRowHighlightOptions.
     */
    "editor.storyRowHighlight": "none" | "script" | "command";
    /**
     * What becomes of an editor that was popped out into its own window when that window closes:
     * `"restoreTab"` puts it back as a workspace tab, `"close"` lets it go.
     *
     * A setting rather than a fixed rule because the two answers come from two different habits.
     * Popping a blueprint out to work on it beside the surface it drives is a detour, and the tab
     * coming back is the way back; popping it out to read it once and closing the window is a
     * dismissal, and a tab reappearing is the thing that was just dismissed. See
     * lib/settings/detachedEditorCloseOptions.
     */
    "editor.detachedEditorOnClose": "restoreTab" | "close";
    /**
     * Ask for confirmation before a workspace window closes.
     *
     * Replaces the legacy `workspace.confirmOnClose`, which shipped as an unread placeholder
     * defaulting to true and is therefore already persisted as true in existing profiles -
     * defaulting *this* feature to off was only possible under a key nobody has on disk.
     */
    "workspace.confirmBeforeClose": boolean;
    /** Closing the last workspace reopens the launcher; when false, the app quits instead. */
    "workspace.returnToLauncherOnClose": boolean;
    /** How many projects the home screen and the native Open Recent submenu keep. */
    "workspace.recentProjectsLimit": number;
    /**
     * Open the project dashboard as a tab every time a workspace opens.
     *
     * Global rather than per-project: this is a habit of the author, not a property of the project,
     * and a `.nlproj` is shared through version control where one teammate's preference would
     * silently override everyone else's.
     */
    "dashboard.openOnWorkspaceOpen": boolean;
    /**
     * Base URL electron-builder downloads the Electron dist from during a game build;
     * "" = official source. A *source*, not a rewrite: electron-builder composes
     * `<mirror><version>/<file>` onto it, so it cannot be expressed as a prefix
     * substitution (see `network.downloadRewrites`).
     */
    "build.electronMirror": string;
    /**
     * Base URL for electron-builder's toolchain binaries - winCodeSign, NSIS, AppImage,
     * 7za; "" = official source. A SECOND source rather than a mode of the one above
     * because its URL layout differs (`<mirror><name>/<name>.7z`), which is exactly why
     * `GameBuildManager` refused to synthesize one from the other. Takes precedence over
     * the `ELECTRON_BUILDER_BINARIES_MIRROR` / `NPM_CONFIG_...` environment variables,
     * which stay honored for hosts already configured that way.
     */
    "build.electronBuilderBinariesMirror": string;
    /**
     * Ordered prefix substitutions applied to download URLs Studio did not choose - the
     * plugin `.zip` and icon a registry index names, and the archive a plugin's
     * `contributes.buildDependencies` names. Those arrive inside a document, so no
     * "source" setting can reach them: mirroring `plugins.registryUrl` mirrors the
     * catalogue and leaves Install following an absolute github.com URL.
     *
     * One key rather than one per rule for the reason `keybindings.overrides` gives: a
     * rule identity would contain dots. First enabled match wins; the result must be
     * `https:` or the rewrite is refused. See `@shared/utils/downloadSource`.
     */
    "network.downloadRewrites": DownloadRewriteRule[];
    /**
     * Plugin store registry index URL; "" = the official NarraLeaf/Plugins index
     * (see @shared/constants/pluginRegistry). Read by the main process when the
     * launcher's Plugins store fetches or installs.
     */
    "plugins.registryUrl": string;
    /**
     * UI template store registry index URL; "" = the official NarraLeaf/UI-Templates
     * index (see @shared/constants/uiTemplateRegistry). Read by the main process when
     * the UI editor's template store fetches the index or a template bundle.
     */
    "uiTemplates.registryUrl": string;
    /**
     * How long between automatic checkpoints, in minutes. **0 disables them.**
     *
     * A checkpoint only happens when a versioned file has actually been written since
     * the last one - the interval is a ceiling on how often, never a schedule that
     * fires on its own. Global rather than per-project because it describes how often
     * the author wants Studio interrupting to record, which is a habit rather than a
     * property of any one project.
     */
    "versionControl.checkpointIntervalMinutes": number;
    /**
     * Record a checkpoint when a workspace window is closed.
     *
     * A DIFFERENT question from the interval above, which is why it is its own key
     * rather than a mode of it: the interval describes how often the author wants
     * Studio recording *while they work*, and this one is about the moment after which
     * nothing is watching the working tree at all. An author who edits for an hour and
     * closes without committing has that hour recorded nowhere if both are off - so
     * this defaults on, and turning the interval off does not turn it off.
     *
     * Read by the main process in `App.checkpointBeforeClose`, which is the only caller
     * of the `project-close` checkpoint reason.
     */
    "versionControl.checkpointOnClose": boolean;
    /**
     * Name recorded as the author on commits and checkpoints; "" = unset.
     *
     * The interim answer to Lore's `identity` global, which is per-call rather than
     * stored in the repository. It becomes the fallback once there is a logged-in
     * identity to prefer; see VcsManager.resolveIdentity for what an unset value
     * records.
     */
    "versionControl.authorName": string;
    /**
     * Email recorded alongside the author name; "" = unset.
     *
     * Lore's identity is ONE verbatim string, so this is not a second field it stores -
     * `composeVcsIdentity` folds the two into the `Name <email>` form every other
     * version-control tool writes and reads. Separate here because that is how an author
     * thinks of it, and because a name typed with the angle brackets by hand is the kind
     * of thing that ends up in every revision of a repository.
     */
    "versionControl.authorEmail": string;
    /**
     * The servers this installation has signed in to, one entry per server origin.
     *
     * **Not a preference and not a credential.** No preference, because nobody chose it by
     * typing into a field and it means nothing on another machine - which is why it has no
     * settings row, is absent from the reset and export scopes, and stays out of an exported
     * settings file for free. No credential, because the token is not here: it went into the
     * backend's own per-user store, and all that is kept here is who the server said that
     * token belongs to.
     *
     * The backend's store is still the authority on whether a session exists at all - the
     * `lore` CLI writes and clears the same store - so this is read together with it rather
     * than trusted on its own. See `VcsManager.getServerSession`.
     */
    "versionControl.serverSessions": VcsServerSession[];
}

export type GlobalStateKeys = string;
export type GlobalStateValue<K extends GlobalStateKeys> = K extends keyof GlobalStateType ? GlobalStateType[K] : any;
export type GlobalState = PersistentState<GlobalStateType>;

/**
 * Default values for global state
 */
export const GLOBAL_STATE_DEFAULTS: Partial<GlobalStateType> = {
    "app.recentProjects": [],
    // `app.language` deliberately has no default here; see its declaration above. A static "en"
    // is what made Studio open in English on a machine that had already said it speaks something
    // else - while `editor.slashAtAlias`, two keys further down, was reading that same machine's
    // languages to decide its own default.
    "app.developerMode": false,
    "app.updateCheckOnLaunch": true,
    "ui.themeMode": "auto",
    "ui.runMode": "devMode",
    "ui.zoomPercent": ZOOM_PERCENT_DEFAULT,
    "ui.accentColor": ACCENT_COLOR_DEFAULT,
    "ui.reduceMotion": false,
    "ui.statusBar.visible": true,
    "ui.statusBar.hiddenItems": [],
    "ui.titleBarSearch.visible": true,
    // The `ui.background*` keys deliberately have no defaults here. Persisted values are untrusted
    // (opacity has to be clamped, fill/anchor whitelisted), so the renderer normalizes them through
    // readBackgroundSettings - which necessarily carries the fallbacks. Repeating them here would
    // be a second source of truth that can only drift.
    "keybindings.overrides": {},
    "editor.fontSize": 14,
    "editor.fontFamily": "Default",
    "editor.surfaceOpacity": 100,
    "editor.lineNumbers": true,
    "editor.softWrap": false,
    "editor.maxActiveEditors": 8,
    "editor.localizedCommands": true,
    "editor.hideParamNames": false,
    "editor.storyRowHighlight": "none",
    "editor.detachedEditorOnClose": "restoreTab",
    "workspace.confirmBeforeClose": false,
    "workspace.returnToLauncherOnClose": true,
    "workspace.recentProjectsLimit": 10,
    "dashboard.openOnWorkspaceOpen": true,
    "build.electronMirror": "",
    "build.electronBuilderBinariesMirror": "",
    "network.downloadRewrites": [],
    "plugins.registryUrl": "",
    "uiTemplates.registryUrl": "",
    "versionControl.checkpointIntervalMinutes": 15,
    "versionControl.checkpointOnClose": true,
    "versionControl.authorName": "",
    "versionControl.authorEmail": "",
    "versionControl.serverSessions": [],
};

/**
 * Keys that once shipped a default and were read by nothing.
 *
 * Removed from {@link GlobalStateType} rather than implemented: a default nothing
 * honors makes the store lie about what Studio does, and an exported settings
 * document (see `@shared/utils/settingsDocument`) would carry the lie to the next
 * machine forever. When one of these features actually ships it declares its own
 * key rather than inheriting a value some profile has been carrying since 2026.
 *
 * `workspace.confirmOnClose` is the legacy spelling of `workspace.confirmBeforeClose`
 * and is on every profile that predates the rename.
 *
 * Swept off disk once, at startup, by `GlobalStateManager.sweepRetiredKeys`.
 */
export const RETIRED_GLOBAL_STATE_KEYS: readonly string[] = [
    "app.showHint",
    "app.notificationsEnabled",
    "app.autoCheckUpdates",
    "workspace.restoreLastWorkspace",
    "workspace.autoSave",
    "workspace.confirmOnClose",
    "sync.autoBackup",
    "sync.backupIntervalMinutes",
    "sync.backupPath",
    "advanced.enableTelemetry",
    "advanced.enableDevTools",
    "advanced.experimentalFeatures",
];
