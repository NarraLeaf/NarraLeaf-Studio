import { PersistentState } from "@shared/utils/persistentState";
import { RecentlyOpenedProject } from "./appStateTypes";

export interface GlobalStateType extends Record<string, any> {
    "app.showHint": boolean;
    "app.recentProjects": RecentlyOpenedProject[];
    "app.language": string;
    "app.notificationsEnabled": boolean;
    "app.autoCheckUpdates": boolean;
    "ui.themeMode": "auto" | "light" | "dark" | string;
    "ui.accentColor": string;
    "ui.compactMode": boolean;
    "ui.reduceMotion": boolean;
    "editor.fontSize": number;
    "editor.fontFamily": string;
    "editor.lineNumbers": boolean;
    "editor.softWrap": boolean;
    "workspace.restoreLastWorkspace": boolean;
    "workspace.confirmOnClose": boolean;
    "workspace.recentProjectsLimit": number;
    "workspace.autoSave": boolean;
    "sync.autoBackup": boolean;
    "sync.backupIntervalMinutes": number;
    "sync.backupPath": string;
    "advanced.enableTelemetry": boolean;
    "advanced.enableDevTools": boolean;
    "advanced.experimentalFeatures": boolean;
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
    "ui.accentColor": "blue",
    "ui.compactMode": false,
    "ui.reduceMotion": false,
    "editor.fontSize": 14,
    "editor.fontFamily": "Default",
    "editor.lineNumbers": true,
    "editor.softWrap": false,
    "workspace.restoreLastWorkspace": true,
    "workspace.confirmOnClose": true,
    "workspace.recentProjectsLimit": 10,
    "workspace.autoSave": true,
    "sync.autoBackup": true,
    "sync.backupIntervalMinutes": 30,
    "sync.backupPath": "",
    "advanced.enableTelemetry": false,
    "advanced.enableDevTools": false,
    "advanced.experimentalFeatures": false,
};
