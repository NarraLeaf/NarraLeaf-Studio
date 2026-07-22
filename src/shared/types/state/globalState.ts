import { ACCENT_COLOR_DEFAULT } from "@shared/constants/accent";
import { ZOOM_PERCENT_DEFAULT } from "@shared/constants/zoom";
import { PersistentState } from "@shared/utils/persistentState";
import { RecentlyOpenedProject } from "./appStateTypes";

export interface GlobalStateType extends Record<string, any> {
    "app.showHint": boolean;
    "app.recentProjects": RecentlyOpenedProject[];
    "app.language": string;
    "app.notificationsEnabled": boolean;
    "app.autoCheckUpdates": boolean;
    "ui.themeMode": "auto" | "light" | "dark" | string;
    /** Studio UI zoom as a whole percentage; see @shared/constants/zoom. */
    "ui.zoomPercent": number;
    /**
     * Accent preset id from @shared/constants/accent — not a free color. Applied by the renderer
     * (lib/appearance) by overriding the `--nl-primary` channels, which every `*-primary` utility
     * resolves through. Studio windows only; a shipped game keeps the brand anchor.
     */
    "ui.accentColor": string;
    "ui.compactMode": boolean;
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
    "editor.lineNumbers": boolean;
    "editor.softWrap": boolean;
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
    "workspace.restoreLastWorkspace": boolean;
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
    "workspace.recentProjectsLimit": number;
    "workspace.autoSave": boolean;
    /**
     * Open the project dashboard as a tab every time a workspace opens.
     *
     * Global rather than per-project: this is a habit of the author, not a property of the project,
     * and a `.nlproj` is shared through version control where one teammate's preference would
     * silently override everyone else's.
     */
    "dashboard.openOnWorkspaceOpen": boolean;
    "sync.autoBackup": boolean;
    "sync.backupIntervalMinutes": number;
    "sync.backupPath": string;
    "advanced.enableTelemetry": boolean;
    "advanced.enableDevTools": boolean;
    "advanced.experimentalFeatures": boolean;
    /** Electron download mirror for cross-platform game builds; "" = official source. */
    "build.electronMirror": string;
    /**
     * Plugin store registry index URL; "" = the official NarraLeaf/Plugins index
     * (see @shared/constants/pluginRegistry). Read by the main process when the
     * launcher's Plugins store fetches or installs.
     */
    "plugins.registryUrl": string;
}

export type GlobalStateKeys = string;
export type GlobalStateValue<K extends GlobalStateKeys> = K extends keyof GlobalStateType ? GlobalStateType[K] : any;
export type GlobalState = PersistentState<GlobalStateType>;

/**
 * Default values for global state
 */
export const GLOBAL_STATE_DEFAULTS: Partial<GlobalStateType> = {
    "app.showHint": true,
    "app.recentProjects": [],
    "app.language": "en",
    "app.notificationsEnabled": true,
    "app.autoCheckUpdates": true,
    "ui.themeMode": "auto",
    "ui.zoomPercent": ZOOM_PERCENT_DEFAULT,
    "ui.accentColor": ACCENT_COLOR_DEFAULT,
    "ui.compactMode": false,
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
    "editor.lineNumbers": true,
    "editor.softWrap": false,
    "editor.maxActiveEditors": 8,
    "workspace.restoreLastWorkspace": true,
    "workspace.confirmBeforeClose": false,
    "workspace.returnToLauncherOnClose": true,
    "workspace.recentProjectsLimit": 10,
    "workspace.autoSave": true,
    "dashboard.openOnWorkspaceOpen": true,
    "sync.autoBackup": true,
    "sync.backupIntervalMinutes": 30,
    "sync.backupPath": "",
    "advanced.enableTelemetry": false,
    "advanced.enableDevTools": false,
    "advanced.experimentalFeatures": false,
    "build.electronMirror": "",
    "plugins.registryUrl": "",
};
