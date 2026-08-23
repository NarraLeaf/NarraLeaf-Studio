import { ACCENT_COLOR_DEFAULT } from "@shared/constants/accent";
import { CONFIRM_QUIT_DEFAULT } from "@shared/constants/quit";
import {
    SCREEN_EFFECT_QUALITY_DEFAULT,
    SCREEN_EFFECT_QUALITY_KEY,
    SCREEN_EFFECT_THREADS_DEFAULT,
    SCREEN_EFFECT_THREADS_KEY,
} from "@shared/constants/screenEffects";
import { ZOOM_PERCENT_DEFAULT } from "@shared/constants/zoom";
import { WINDOW_ICON_DEFAULT } from "@shared/constants/windowIcon";
import { DownloadRewriteRule } from "@shared/types/downloadSource";
import { SPELLCHECK_LANGUAGE_DEFAULT } from "@shared/types/spellcheck";
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
     * Whether ⌘Q has to be pressed twice before it quits, instead of quitting on the first press.
     *
     * macOS only, and not because the key combination is: Windows and Linux quit with Alt+F4 or the
     * window close box, neither of which is a key away from anything an author presses on purpose.
     * The row is still shown on those platforms, disabled, rather than hidden - a preference that
     * appears and disappears with the machine is one that gets reported as missing.
     */
    "app.confirmQuit": boolean;
    /**
     * Whether this profile has been told that Studio keeps running after its last window closes.
     *
     * Installation state rather than a preference, like `app.onboardingVersion`: it has no
     * settings row and deliberately no entry in `GLOBAL_STATE_DEFAULTS`, because absence is what
     * makes the notice show. See `@shared/constants/update`.
     */
    "app.trayResidencyNoticeShown": boolean;
    /**
     * How good the screen effects baked for a Dev Mode session have to be.
     *
     * Dev Mode only. Previews and builds are always `final` and no setting reaches them: what they
     * produce is what a player receives. See `@shared/constants/screenEffects`.
     */
    [SCREEN_EFFECT_QUALITY_KEY]: "draft" | "final" | string;
    /**
     * How many threads draw frames while a bake's encoder runs, or `auto`.
     *
     * Every bake, not just Dev Mode's: this one is a statement about the machine rather than about
     * the file, and drawing a frame on another thread cannot change it.
     */
    [SCREEN_EFFECT_THREADS_KEY]: "auto" | "1" | "2" | "3" | "4" | string;
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
     * Which built-in mark Studio's windows wear, as an id from `@shared/constants/windowIcon` -
     * not a file name. Applied by the main process, which is the only side that can call
     * `BrowserWindow.setIcon`; Windows and Linux only, since macOS has no per-window icon at all.
     */
    "ui.windowIcon": string;
    /**
     * Accent preset id from @shared/constants/accent — not a free color. Applied by the renderer
     * (lib/appearance) by overriding the `--nl-primary` channels, which every `*-primary` utility
     * resolves through. Studio windows only; a shipped game keeps the brand anchor.
     */
    "ui.accentColor": string;
    /**
     * Typeface for the Studio interface: one of the preset ids in
     * `renderer/lib/settings/uiFontOptions`, or the name of a family installed on this computer.
     * Nothing validates it against a list — a `global.json` carried to another machine may well
     * name a font that is not there, which CSS resolves by falling through to the base stack.
     * Applied by the renderer (lib/appearance) by overriding `--nl-ui-font`, which only Studio
     * chrome reads; a shipped game and the Dev Mode stage keep the base stack.
     */
    "ui.fontFamily": string;
    /**
     * Calm the Studio interface: no CSS transitions or animations (styles.css) and no
     * framer-motion transform/layout animations (the MotionConfig in lib/renderApp). Independent
     * of the OS-level `prefers-reduced-motion`, which is honored on its own — this is for wanting
     * it here without wanting it everywhere. Game content is exempt in both layers.
     */
    "ui.reduceMotion": boolean;
    /**
     * How the workspace's menus (File, Help, and whatever a panel or a plugin registers) are
     * presented in the title bar: `toolbar` leaves them beside the run controls as named
     * dropdowns, `hamburger` collapses all of them into a single button whose menu lists them as
     * submenus.
     *
     * Off macOS only. There the same groups are the system menu bar (`useNativeMenuSync`), the
     * title bar never draws them, and neither value would change anything - which is why the
     * settings row says so rather than pretending to work.
     */
    "ui.menuBar.mode": "toolbar" | "hamburger" | string;
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
     * Which language the story script is spellchecked in: `"project"` follows the project's source
     * language, `"off"` checks nothing, anything else is a Chromium dictionary name (`"en-GB"`).
     *
     * Global rather than per-project even though its default is read off the project, because it
     * describes the machine this author writes on - which dictionary is installed, which regional
     * English they want - and a `.nlproj` is shared, where one teammate's answer would override
     * everyone else's. See `@shared/types/spellcheck`.
     */
    "editor.spellcheckLanguage": string;
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
    /**
     * Reopen the project the last session was in, instead of starting on the home screen.
     *
     * Read once per launch by `App.resolveSessionStartupProject`. `--project` and `--launcher`
     * both override it; a project that no longer opens falls back to the home screen on its own,
     * so this needs no "unless it is broken" clause.
     *
     * Off by default. A launch that puts the author straight back into a project is a launch that
     * has decided for them which of their projects this session is about, and Studio opens one
     * window per project - so the reopen can only ever restore one of however many were open. The
     * home screen is where that choice is made, and it is one click from the project they left.
     */
    "workspace.reopenLastProject": boolean;
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
     * The author line a new project starts with - a person, a studio, a publisher; "" = unset.
     *
     * A default rather than a value: the project wizard only ever fills its **blank** author field
     * with it (the same rule `sourceLocale` follows there), so changing it never rewrites a project
     * that already named someone. It is stored on this installation and copied into each project's
     * own config, which is what keeps it out of the `.nlproj` shared with a team - one machine's
     * habit must not become every collaborator's answer.
     *
     * Distinct from {@link GlobalStateType["versionControl.authorName"]}, which signs revisions.
     * That is who made this change; this is who the work belongs to, and on a studio's machine the
     * two are routinely different words.
     */
    "project.defaultAuthor": string;
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
    /**
     * The token this installation signs in to each server with, sealed.
     *
     * Keyed by the same `remoteOrigin` the sessions are, and holding
     * `safeStorage` ciphertext rather than the token: Studio needs the token
     * for the questions it asks a server directly - which projects are on it,
     * and making another - and those happen long after the author pasted it.
     * See `vcs/serverTokens.ts` for why it is kept at all, and what a machine
     * that cannot seal does instead.
     *
     * **Never leaves the main process.** Nothing over IPC reads it.
     */
    "versionControl.serverTokens": Record<string, string>;
    /**
     * What this installation of Studio calls itself to a Team server.
     *
     * A random id, minted the first time a session is opened and never again, and the
     * only thing on this machine that says "the same Studio came back". A server needs
     * that to tell one installation from another - one person is routinely a desktop and
     * a laptop - and nothing already stored answers it: an account is a person, and a
     * connection is new every time.
     *
     * **Deliberately without a default.** A default here would be written to every
     * profile on disk the first time the store was read (see the note on the defaults
     * below), which would give every installation the same id. It is minted on first use
     * instead - see `managers/team/clientInstance.ts`.
     *
     * Not a credential and not a name: it identifies nothing outside the servers this
     * machine is signed in to, and it is not what a collaborator sees - that is the
     * account, and the label beside it.
     */
    "team.installationId": string;
    /**
     * What a collaborator sees this machine called, or empty for the machine's own name.
     *
     * Empty is the ordinary case and reads as the host name. It is a setting rather than
     * a fact so that somebody who would rather not publish their host name to their
     * team's server has somewhere to say so.
     */
    "team.machineLabel": string;
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
    "app.confirmQuit": CONFIRM_QUIT_DEFAULT,
    [SCREEN_EFFECT_QUALITY_KEY]: SCREEN_EFFECT_QUALITY_DEFAULT,
    [SCREEN_EFFECT_THREADS_KEY]: SCREEN_EFFECT_THREADS_DEFAULT,
    "ui.themeMode": "auto",
    "ui.runMode": "devMode",
    "ui.zoomPercent": ZOOM_PERCENT_DEFAULT,
    "ui.windowIcon": WINDOW_ICON_DEFAULT,
    "ui.accentColor": ACCENT_COLOR_DEFAULT,
    "ui.fontFamily": "Default",
    "ui.reduceMotion": false,
    // Collapsed into one button, which is the arrangement Studio ships in: the title bar is its only
    // full-width strip, and the menus lose nothing by being one button - see `menuBarOptions`.
    "ui.menuBar.mode": "hamburger",
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
    "editor.spellcheckLanguage": SPELLCHECK_LANGUAGE_DEFAULT,
    "editor.detachedEditorOnClose": "restoreTab",
    "workspace.confirmBeforeClose": false,
    "workspace.reopenLastProject": false,
    "workspace.recentProjectsLimit": 10,
    "dashboard.openOnWorkspaceOpen": true,
    "build.electronMirror": "",
    "build.electronBuilderBinariesMirror": "",
    "network.downloadRewrites": [],
    "plugins.registryUrl": "",
    "uiTemplates.registryUrl": "",
    "project.defaultAuthor": "",
    "versionControl.checkpointIntervalMinutes": 15,
    "versionControl.checkpointOnClose": true,
    "versionControl.authorName": "",
    "versionControl.authorEmail": "",
    "versionControl.serverSessions": [],
    "versionControl.serverTokens": {},
    // `team.installationId` deliberately has no default; see its declaration above. A
    // default would be written to disk on first read and every installation would then
    // be calling itself the same thing.
    "team.machineLabel": "",
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
 * `workspace.returnToLauncherOnClose` is the switch that used to make closing a workspace and
 * returning to the home screen the same exit. Both are now available at once - the close box and
 * File ▸ Back to Launcher - so nothing reads it, and every profile that predates the split is
 * carrying it.
 *
 * Swept off disk once, at startup, by `GlobalStateManager.sweepRetiredKeys`.
 */
export const RETIRED_GLOBAL_STATE_KEYS: readonly string[] = [
    // Lived for one commit on develop under a `devMode.` prefix, before the setting gained a
    // neighbour that is not Dev Mode's and both moved under `screenEffects.`. Swept rather than
    // migrated because the value it could hold is the default anyway - nobody had time to change it.
    "devMode.screenEffectQuality",
    "app.showHint",
    "app.notificationsEnabled",
    "app.autoCheckUpdates",
    "workspace.restoreLastWorkspace",
    "workspace.autoSave",
    "workspace.confirmOnClose",
    "workspace.returnToLauncherOnClose",
    "sync.autoBackup",
    "sync.backupIntervalMinutes",
    "sync.backupPath",
    "advanced.enableTelemetry",
    "advanced.enableDevTools",
    "advanced.experimentalFeatures",
];
