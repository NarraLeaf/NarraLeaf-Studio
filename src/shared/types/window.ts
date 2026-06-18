
import type { PluginPermissionPromptProps, PluginPermissionPromptResult } from "./pluginPermissions";

export enum WindowAppType {
    Launcher = "launcher",
    Settings = "settings",
    Workspace = "workspace",
    ProjectWizard = "project-wizard",
    DevMode = "dev-mode",
    PluginPermissionPrompt = "plugin-permission",
    Raw = "raw",
}

export type WindowProps = {
    [WindowAppType.Launcher]: {
    },
    [WindowAppType.Settings]: {
        highlight?: string;
    },
    [WindowAppType.Workspace]: {
        projectPath: string;
    },
    [WindowAppType.ProjectWizard]: {
    },
    [WindowAppType.DevMode]: {
        projectPath: string;
        entry: import("./devMode").DevModeEntry;
    },
    [WindowAppType.PluginPermissionPrompt]: PluginPermissionPromptProps,
    [WindowAppType.Raw]: {
    },
}

export type WindowVisibilityStatus = "minimized" | "maximized" | "normal";

export interface WindowControlAbility {
    minimizable: boolean;
    maximizable: boolean;
    closable: boolean;
    resizable: boolean;
    movable: boolean;
    fullscreenable: boolean;
}

export type WindowLuanchOptions = {
    modal: boolean;
    child: boolean;
};

/**
 * Window close result types for each window type
 * Defines the return value type when a window is closed with closeWith()
 */
export type WindowCloseResults = {
    [WindowAppType.Launcher]: null;
    [WindowAppType.Settings]: null;
    [WindowAppType.Workspace]: null;
    [WindowAppType.ProjectWizard]: { created: boolean; projectPath: string } | null;
    [WindowAppType.DevMode]: null;
    [WindowAppType.PluginPermissionPrompt]: PluginPermissionPromptResult;
    [WindowAppType.Raw]: null;
};
