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
    "ui.accentColor": string;
    "ui.compactMode": boolean;
    "ui.reduceMotion": boolean;
    "editor.fontSize": number;
    "editor.fontFamily": string;
    "editor.lineNumbers": boolean;
    "editor.softWrap": boolean;
    "editor.maxActiveEditors": number;
    "workspace.restoreLastWorkspace": boolean;
    /**
     * Ask for confirmation before a workspace window closes.
     *
     * Replaces the legacy `workspace.confirmOnClose`, which shipped as an unread placeholder
     * defaulting to true and is therefore already persisted as true in existing profiles —
     * defaulting *this* feature to off was only possible under a key nobody has on disk.
     */
    "workspace.confirmBeforeClose": boolean;
    /** Closing the last workspace reopens the launcher; when false, the app quits instead. */
    "workspace.returnToLauncherOnClose": boolean;
    "workspace.recentProjectsLimit": number;
    "workspace.autoSave": boolean;
    "sync.autoBackup": boolean;
    "sync.backupIntervalMinutes": number;
    "sync.backupPath": string;
    "advanced.enableTelemetry": boolean;
    "advanced.enableDevTools": boolean;
    "advanced.experimentalFeatures": boolean;
    /** Electron download mirror for cross-platform game builds; "" = official source. */
    "build.electronMirror": string;
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
    "ui.accentColor": "blue",
    "ui.compactMode": false,
    "ui.reduceMotion": false,
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
    "sync.autoBackup": true,
    "sync.backupIntervalMinutes": 30,
    "sync.backupPath": "",
    "advanced.enableTelemetry": false,
    "advanced.enableDevTools": false,
    "advanced.experimentalFeatures": false,
    "build.electronMirror": "",
};
