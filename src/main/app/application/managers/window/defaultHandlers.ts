import { IPCEventType } from "@shared/types/ipcEvents";
import { IPCHandler } from "./handlers/IPCHandler";
import { AppGlobalStateGetAllHandler, AppGlobalStateGetHandler, AppGlobalStateSetHandler, AppAddRecentProjectHandler, AppInfoHandler, AppPlatformInfoHandler, AppTerminateHandler, AppWindowControlHandler, AppWindowCloseHandler, AppWindowCloseWithHandler, AppWindowEditCommandHandler, AppWindowGetControlHandler, AppWindowGetFullscreenHandler, AppWindowReadyHandler, AppWindowControlAbilityHandler, AppPropsHandler, AppSystemPathHandler } from "./handlers/appAction";
import { AppSettingsWindowLaunchHandler } from "./handlers/settingAction";
import {
    FsStatHandler, FsListHandler, FsDetailsHandler, FsRequestReadHandler, FsRequestWriteHandler,
    FsCreateDirHandler, FsEnsureRegularFileHandler, FsWriteFileNoFollowHandler, FsRecoverCorruptedJsonFileHandler, FsDeleteFileHandler, FsDeleteDirHandler, FsRenameHandler,
    FsCopyFileHandler, FsCopyDirHandler, FsMoveFileHandler, FsMoveDirHandler,
    FsFileExistsHandler, FsDirExistsHandler, FsIsFileHandler, FsIsDirHandler,
    FsSelectFileHandler, FsSelectDirectoryHandler, FsGrantFileAccessHandler, FsHashHandler,
} from "./handlers/fsAction";
import { ProjectWizardLaunchHandler, ProjectWizardSelectDirectoryHandler, ProjectWizardGetDefaultDirectoryHandler } from "./handlers/projectWizardAction";
import { WorkspaceExportProjectPackageHandler, WorkspaceImportProjectPackageHandler } from "./handlers/projectPackageAction";
import { WorkspaceLaunchHandler, WorkspaceOpenRecentHandler, WorkspaceSelectFolderHandler, WorkspaceCloseHandler, WorkspaceExportConsoleLogsHandler, WorkspaceMenuSyncHandler } from "./handlers/workspaceAction";
import {
    DevModeFullscreenGetHandler,
    DevModeFullscreenSetHandler,
    DevModeGetStatusHandler,
    DevModeLaunchHandler,
    DevModeOpenBlueprintInWorkspaceHandler,
    DevModeReloadHandler,
    DevModeStopHandler,
    DevModeResolveAssetUrlHandler,
    DevModeResolveImageAssetUrlHandler,
    DevModeForwardBlueprintDebugEventHandler,
} from "./handlers/devModeAction";
import {
    DevModeSaveDeleteHandler,
    DevModeSaveListIdsHandler,
    DevModeSaveReadHandler,
    DevModeSaveReadPreviewHandler,
    DevModeSaveWriteHandler,
} from "./handlers/devModeSaveAction";
import {
    PreviewGetStatusHandler,
    PreviewLaunchHandler,
    PreviewStopHandler,
} from "./handlers/previewAction";
import {
    GameBuildCancelHandler,
    GameBuildGetStatusHandler,
    GameBuildPreflightHandler,
    GameBuildSelectOutputDirHandler,
    GameBuildStartHandler,
} from "./handlers/gameBuildAction";
import { PluginPermissionGrantHandler, PluginPermissionPromptLaunchHandler } from "./handlers/pluginPermissionAction";
import {
    PluginApproveHandler,
    PluginInstallLocalHandler,
    PluginListHandler,
    PluginReportLoadErrorHandler,
    PluginRevokeHandler,
    PluginRuntimeListHandler,
    PluginSetEnabledHandler,
    PluginUninstallHandler,
    PluginWorkspaceListHandler,
} from "./handlers/pluginManagerAction";
import {
    BlueprintPersistenceGetAllHandler,
    BlueprintPersistenceGetValueHandler,
    BlueprintPersistenceRemoveValueHandler,
    BlueprintPersistenceSetValueHandler,
} from "./handlers/blueprintPersistenceAction";
import {
    PrivilegedBashExecuteHandler,
    PrivilegedFsCallHandler,
    PrivilegedPermissionRevokePluginHandler,
    PrivilegedPermissionRequestHandler,
} from "./handlers/privilegedAction";

/**
 * All default IPC handlers. Handlers are stateless — they receive the target
 * window on every handle() call — so the app instantiates this list once and
 * routes requests to the right window by sender.
 */
export function createDefaultIPCHandlers(): IPCHandler<IPCEventType>[] {
    return [
        new AppPlatformInfoHandler(),
        new AppInfoHandler(),

        new AppPropsHandler(),
        new AppWindowControlHandler(),
        new AppWindowCloseHandler(),
        new AppWindowEditCommandHandler(),
        new AppWindowCloseWithHandler(),
        new AppWindowGetControlHandler(),
        new AppWindowGetFullscreenHandler(),
        new AppWindowControlAbilityHandler(),
        new AppWindowReadyHandler(),
        new AppTerminateHandler(),
        new AppGlobalStateGetHandler(),
        new AppGlobalStateSetHandler(),
        new AppGlobalStateGetAllHandler(),
        new AppAddRecentProjectHandler(),
        new AppSystemPathHandler(),

        new AppSettingsWindowLaunchHandler(),

        // Project wizard handlers
        new ProjectWizardLaunchHandler(),
        new ProjectWizardSelectDirectoryHandler(),
        new ProjectWizardGetDefaultDirectoryHandler(),

        // Workspace handlers
        new WorkspaceLaunchHandler(),
        new WorkspaceOpenRecentHandler(),
        new WorkspaceSelectFolderHandler(),
        new WorkspaceCloseHandler(),
        new WorkspaceExportProjectPackageHandler(),
        new WorkspaceImportProjectPackageHandler(),
        new WorkspaceExportConsoleLogsHandler(),
        new WorkspaceMenuSyncHandler(),

        // Dev mode handlers
        new DevModeLaunchHandler(),
        new DevModeStopHandler(),
        new DevModeReloadHandler(),
        new DevModeGetStatusHandler(),
        new DevModeFullscreenGetHandler(),
        new DevModeFullscreenSetHandler(),
        new DevModeOpenBlueprintInWorkspaceHandler(),
        new DevModeForwardBlueprintDebugEventHandler(),
        new DevModeResolveAssetUrlHandler(),
        new DevModeResolveImageAssetUrlHandler(),
        new DevModeSaveWriteHandler(),
        new DevModeSaveReadHandler(),
        new DevModeSaveListIdsHandler(),
        new DevModeSaveReadPreviewHandler(),
        new DevModeSaveDeleteHandler(),

        // Preview runtime handlers
        new PreviewLaunchHandler(),
        new PreviewStopHandler(),
        new PreviewGetStatusHandler(),

        // Production game build handlers
        new GameBuildStartHandler(),
        new GameBuildCancelHandler(),
        new GameBuildGetStatusHandler(),
        new GameBuildSelectOutputDirHandler(),
        new GameBuildPreflightHandler(),

        // Blueprint persistent variable storage handlers
        new BlueprintPersistenceGetAllHandler(),
        new BlueprintPersistenceGetValueHandler(),
        new BlueprintPersistenceSetValueHandler(),
        new BlueprintPersistenceRemoveValueHandler(),

        // Plugin permission handlers
        new PluginPermissionPromptLaunchHandler(),
        new PluginPermissionGrantHandler(),
        new PluginListHandler(),
        new PluginInstallLocalHandler(),
        new PluginSetEnabledHandler(),
        new PluginApproveHandler(),
        new PluginUninstallHandler(),
        new PluginRevokeHandler(),
        new PluginWorkspaceListHandler(),
        new PluginRuntimeListHandler(),
        new PluginReportLoadErrorHandler(),

        // Actor-aware privileged facade handlers
        new PrivilegedFsCallHandler(),
        new PrivilegedPermissionRequestHandler(),
        new PrivilegedPermissionRevokePluginHandler(),
        new PrivilegedBashExecuteHandler(),

        // File system handlers
        new FsStatHandler(),
        new FsListHandler(),
        new FsDetailsHandler(),
        new FsRequestReadHandler(),
        new FsRequestWriteHandler(),
        new FsEnsureRegularFileHandler(),
        new FsWriteFileNoFollowHandler(),
        new FsRecoverCorruptedJsonFileHandler(),
        new FsCreateDirHandler(),
        new FsDeleteFileHandler(),
        new FsDeleteDirHandler(),
        new FsRenameHandler(),
        new FsCopyFileHandler(),
        new FsCopyDirHandler(),
        new FsMoveFileHandler(),
        new FsMoveDirHandler(),
        new FsFileExistsHandler(),
        new FsDirExistsHandler(),
        new FsIsFileHandler(),
        new FsIsDirHandler(),
        new FsSelectFileHandler(),
        new FsSelectDirectoryHandler(),
        new FsGrantFileAccessHandler(),
        new FsHashHandler(),
    ] as IPCHandler<IPCEventType>[];
}
