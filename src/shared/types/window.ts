
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

/**
 * A surface the Settings window can ask a workspace to reveal. Both live in the workspace because
 * that is where their state is (the keybinding registry, the background dialog's live preview),
 * so Settings can only ask — see `app.requestWorkspaceView`.
 */
export type WorkspaceViewRequest = "keybindings" | "backgroundImage";

export enum WindowControlPolicy {
    Standard = "standard",
    MacNativeOutsideTitleBar = "mac-native-outside-titlebar",
    None = "none",
}

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
