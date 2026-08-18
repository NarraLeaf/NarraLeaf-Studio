import type {
  PluginPermissionPromptProps,
  PluginPermissionPromptResult
} from "./pluginPermissions";
import type { ServerTrustPromptProps, ServerTrustPromptResult } from "./serverTrust";

export enum WindowAppType {
  Launcher = "launcher",
  Settings = "settings",
  Workspace = "workspace",
  ProjectWizard = "project-wizard",
  DevMode = "dev-mode",
  PluginPermissionPrompt = "plugin-permission",
  ServerTrustPrompt = "server-trust",
  Raw = "raw"
}

export type WindowProps = {
  [WindowAppType.Launcher]: {
    /**
     * Open in first-run setup instead of on the home screen.
     *
     * A window prop rather than something the renderer works out for itself, for the reason
     * `recovery` below gives: the decision is available synchronously in the main process
     * (the marker is one `globalState.get`), and handing it over with the window means the
     * first frame is already the right one. Read it in the renderer and the home screen paints
     * first, then gets replaced - which is exactly the flash a first launch should not have.
     */
    onboarding?: boolean;
  };
  [WindowAppType.Settings]: {
    /** A setting key (or category key) to select and scroll to on open. */
    highlight?: string;
  };
  [WindowAppType.Workspace]: {
    projectPath: string;
    /**
     * Open this project as a recovery shell instead of as a workspace.
     *
     * A window prop rather than renderer state because the mode is decided by a *reload*: the
     * whole point is to throw away whatever the failed boot left in memory and come back with a
     * different startup. `workspace.setRecoveryMode` writes it here and reloads the window, so
     * the flag is the first thing the new renderer reads and nothing has to be told twice.
     */
    recovery?: boolean;
    /**
     * What sent the author here, verbatim.
     *
     * The failure that made recovery mode worth entering usually happened in the renderer that
     * is about to be discarded - most often the workspace init error behind the error screen -
     * and re-deriving it after the reload is not always possible (a service that threw on the
     * first read may quietly succeed on the second). Carried across so the recovery panel can
     * list it as the first anomaly.
     */
    recoveryReason?: string;
  };
  [WindowAppType.ProjectWizard]: {};
  [WindowAppType.DevMode]: {
    projectPath: string;
    entry: import("./devMode").DevModeEntry;
  };
  [WindowAppType.PluginPermissionPrompt]: PluginPermissionPromptProps;
  [WindowAppType.ServerTrustPrompt]: ServerTrustPromptProps;
  [WindowAppType.Raw]: {};
};

export type WindowVisibilityStatus = "minimized" | "maximized" | "normal";

/**
 * A surface the Settings window can ask a workspace to reveal, because it lives in the workspace
 * and needs its live state (the background dialog's preview) - Settings can only ask; see
 * `app.requestWorkspaceView`.
 */
export type WorkspaceViewRequest = "backgroundImage";

export enum WindowControlPolicy {
  Standard = "standard",
  MacNativeOutsideTitleBar = "mac-native-outside-titlebar",
  None = "none"
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
  [WindowAppType.ServerTrustPrompt]: ServerTrustPromptResult;
  [WindowAppType.Raw]: null;
};
