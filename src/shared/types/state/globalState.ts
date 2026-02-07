import { PersistentState } from "@shared/utils/persistentState";
import { ObjectPaths } from "../persistentState";
import { RecentlyOpenedProject } from "./appStateTypes";

export interface GlobalStateStructure {
    app: {
        showHint: boolean;
        recentProjects: RecentlyOpenedProject[];
        language: "en" | "zh";
        notificationsEnabled: boolean;
        autoCheckUpdates: boolean;
    };
    ui: {
        themeMode: "dark" | "light" | "auto";
        accentColor: string;
        compactMode: boolean;
        reduceMotion: boolean;
    };
    editor: {
        fontSize: number;
        fontFamily: "inter" | "system" | "monospace";
        lineNumbers: boolean;
        softWrap: boolean;
    };
    workspace: {
        restoreLastWorkspace: boolean;
        confirmOnClose: boolean;
        recentProjectsLimit: number;
        autoSave: boolean;
    };
    sync: {
        autoBackup: boolean;
        backupIntervalMinutes: number;
        backupPath: string;
    };
    advanced: {
        enableTelemetry: boolean;
        enableDevTools: boolean;
        experimentalFeatures: boolean;
    };
}

export type GlobalStateKeys = ObjectPaths<GlobalStateStructure>;
export type GlobalStateType = {
    [K in GlobalStateKeys]: K extends ObjectPaths<GlobalStateStructure>
        ? import("../persistentState").ObjectPathValue<GlobalStateStructure, K>
        : never;
};
export type GlobalStateValue<K extends GlobalStateKeys> = GlobalStateType[K];
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
    "editor.fontFamily": "inter",
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
