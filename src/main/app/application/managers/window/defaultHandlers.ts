import { IPCEventType } from "@shared/types/ipcEvents";
import { IPCHandler } from "./handlers/IPCHandler";
import { AppGlobalStateGetAllHandler, AppGlobalStateGetHandler, AppGlobalStateSetHandler, AppAddRecentProjectHandler, AppRemoveRecentProjectHandler, AppRevealRecentProjectHandler, AppCheckRecentProjectsHandler, AppInfoHandler, AppOpenExternalHandler, AppPickBackgroundImageHandler, AppPlatformInfoHandler, AppReadBackgroundImageHandler, AppReportRendererErrorHandler, AppTerminateHandler, AppWindowControlHandler, AppDetachedWindowControlHandler, AppWindowCloseHandler, AppWindowCloseWithHandler, AppWindowEditCommandHandler, AppWindowGetControlHandler, AppWindowGetFullscreenHandler, AppWindowReadyHandler, AppWindowControlAbilityHandler, AppPropsHandler, AppSystemPathHandler, AppExportDiagnosticsHandler, AppProbeDownloadSourceHandler, AppCacheInventoryHandler, AppCacheClearHandler, AppGlobalStateDeleteHandler, AppExportSettingsHandler, AppImportSettingsHandler } from "./handlers/appAction";
import { AppCountWorkspaceWindowsHandler, AppRequestWorkspaceViewHandler, AppSettingsWindowLaunchHandler } from "./handlers/settingAction";
import {
    SpellcheckCheckHandler,
    SpellcheckClearHandler,
    SpellcheckConfigureHandler,
    SpellcheckDownloadHandler,
    SpellcheckListAvailableHandler,
    SpellcheckListInstalledHandler,
    SpellcheckRemoveHandler,
    SpellcheckStatusHandler,
    SpellcheckSuggestHandler,
} from "./handlers/spellcheckAction";
import { AppUpdateCheckHandler, AppUpdateDownloadHandler, AppUpdateGetStateHandler, AppUpdateInstallHandler } from "./handlers/updateAction";
import {
    FsStatHandler, FsListHandler, FsDetailsHandler, FsDirectorySizeHandler, FsRequestReadHandler, FsRequestReadDirHandler, FsRequestWriteHandler,
    FsCreateDirHandler, FsEnsureRegularFileHandler, FsWriteFileNoFollowHandler, FsRecoverCorruptedJsonFileHandler, FsDeleteFileHandler, FsDeleteDirHandler, FsRenameHandler,
    FsCopyFileHandler, FsCopyDirHandler, FsMoveFileHandler, FsMoveDirHandler,
    FsFileExistsHandler, FsDirExistsHandler, FsIsFileHandler, FsIsDirHandler,
    FsSelectFileHandler, FsSelectDirectoryHandler, FsGrantFileAccessHandler, FsHashHandler,
} from "./handlers/fsAction";
import {
    VcsGetAvailabilityHandler, VcsIsRepositoryHandler, VcsGetInfoHandler, VcsGetHistoryHandler, VcsReadBlobHandler,
    VcsReadWorkingFileHandler,
    VcsReadRevisionDocumentsHandler, VcsGetChangedPathsHandler, VcsGetThreeWayHandler, VcsGetMergeBaseHandler,
    VcsDiffRevisionsHandler, VcsDiffWorkingTreeHandler,
    VcsInitRepositoryHandler,
    VcsGetStatusHandler, VcsCommitHandler, VcsCheckpointHandler, VcsRestoreRevisionHandler,
    VcsGetRemoteHandler, VcsSetRemoteHandler, VcsGetSyncStateHandler, VcsPushHandler, VcsSyncHandler, VcsCloneHandler,
    VcsGetServerSessionHandler, VcsSignInHandler, VcsSignOutHandler, VcsTrustAuthorityHandler,
    VcsProbeServerHandler, VcsListServersHandler, VcsAddServerHandler, VcsForgetServerHandler,
    VcsListServerProjectsHandler, VcsCreateServerProjectHandler,
    VcsGetMergeStateHandler, VcsGetMergeDocumentHandler, VcsResolveConflictsHandler, VcsCompleteMergeHandler, VcsUnresolveConflictsHandler,
    VcsRestartConflictsHandler, VcsAbortMergeHandler,
} from "./handlers/vcsAction";
import { ProjectWizardLaunchHandler, ProjectWizardSelectDirectoryHandler, ProjectWizardGetDefaultDirectoryHandler } from "./handlers/projectWizardAction";
import {
    ProjectWizardSelectPackageHandler,
    WorkspaceExportProjectPackageHandler,
    WorkspaceImportProjectPackageHandler,
} from "./handlers/projectPackageAction";
import { PsdBakeHandler, PsdOpenHandler } from "./handlers/psdImport";
import {
    MediaConvertCancelHandler,
    MediaConvertGetStatusHandler,
    MediaConvertStartHandler,
    MediaProbeHandler,
} from "./handlers/mediaAction";
import { WorkspaceLaunchHandler, WorkspaceOpenRecentHandler, WorkspaceIsProjectOpenHandler, WorkspaceSelectFolderHandler, WorkspaceCloseHandler, WorkspaceExportConsoleLogsHandler, WorkspaceMenuSyncHandler, WorkspaceReportLoadResultHandler, WorkspaceSetRecoveryModeHandler, WorkspaceOpenProjectFolderHandler } from "./handlers/workspaceAction";
import { WorkspaceReportWriteFreezeHandler } from "./handlers/workspaceFreezeAction";
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
    DevModeForwardStoryRowHandler,
    DevModeOpenStoryRowInWorkspaceHandler,
} from "./handlers/devModeAction";
import {
    DevModeSaveDeleteHandler,
    DevModeSaveListHeadersHandler,
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
    GameTestLaunchHandler,
    GameTestStopHandler,
} from "./handlers/gameTestAction";
import {
    GameBuildCancelHandler,
    GameBuildGetStatusHandler,
    GameBuildPreflightHandler,
    GameBuildSelectOutputDirHandler,
    GameBuildExportPatchHandler,
    GameBuildSelectPatchFileHandler,
    GameBuildStartHandler,
} from "./handlers/gameBuildAction";
import {
    PluginBuildSecretAvailableHandler,
    PluginBuildSecretSetHandler,
    SigningImportHandler,
    SigningInspectHandler,
    SigningKeystoreAliasesHandler,
    SigningListHandler,
    SigningMacIdentitiesHandler,
    SigningRemoveHandler,
} from "./handlers/signingAction";
import { DistributionCreateKeyHandler } from "./handlers/distributionAction";
import { PluginPermissionGrantHandler, PluginPermissionPromptLaunchHandler } from "./handlers/pluginPermissionAction";
import { ServerTrustPromptHandler } from "./handlers/serverTrustAction";
import {
    PluginApproveHandler,
    PluginInstallFromRegistryHandler,
    PluginInstallLocalHandler,
    PluginListHandler,
    PluginLocaleListHandler,
    PluginRegistryFetchHandler,
    PluginRegistryIconHandler,
    PluginReportLoadErrorHandler,
    PluginRevokeHandler,
    PluginRuntimeListHandler,
    PluginSetEnabledHandler,
    PluginUninstallHandler,
    PluginWorkspaceListHandler,
} from "./handlers/pluginManagerAction";
import {
    UITemplateFetchBundleHandler,
    UITemplateFetchPreviewsHandler,
    UITemplateFetchThemePreviewsHandler,
    UITemplateRegistryFetchHandler,
} from "./handlers/uiTemplateAction";
import {
    ProjectTemplateListHandler,
    ProjectTemplateScaffoldHandler,
} from "./handlers/projectTemplateAction";
import { AssetExportToFolderHandler, AssetFetchRemoteHandler } from "./handlers/assetAction";
import { PuppetRuntimeInstallSdkHandler } from "./handlers/puppetRuntimeAction";
import {
    BlueprintPersistenceGetAllHandler,
    BlueprintPersistenceGetValueHandler,
    BlueprintPersistenceRemoveValueHandler,
    BlueprintPersistenceSetValueHandler,
} from "./handlers/blueprintPersistenceAction";
import { BlueprintNetworkFetchHandler } from "./handlers/blueprintNetworkAction";
import { BlueprintPointerMoveHandler } from "./handlers/blueprintPointerAction";
import {
    BlueprintExternalLinkOpenForPluginHandler,
    BlueprintExternalLinkOpenHandler,
} from "./handlers/blueprintExternalLinkAction";
import {
    BlueprintProgressReadHandler,
    BlueprintProgressWriteHandler,
} from "./handlers/blueprintProgressAction";
import {
    PrivilegedBashExecuteHandler,
    PrivilegedFsCallHandler,
    PrivilegedPermissionRevokePluginHandler,
    PrivilegedPermissionRequestHandler,
} from "./handlers/privilegedAction";

/**
 * All default IPC handlers. Handlers are stateless - they receive the target
 * window on every handle() call - so the app instantiates this list once and
 * routes requests to the right window by sender.
 */
export function createDefaultIPCHandlers(): IPCHandler<IPCEventType>[] {
    return [
        new AppPlatformInfoHandler(),
        new AppInfoHandler(),

        new AppPropsHandler(),
        new AppWindowControlHandler(),
        new AppDetachedWindowControlHandler(),
        new AppWindowCloseHandler(),
        new AppWindowEditCommandHandler(),
        new AppWindowCloseWithHandler(),
        new AppWindowGetControlHandler(),
        new AppWindowGetFullscreenHandler(),
        new AppWindowControlAbilityHandler(),
        new AppWindowReadyHandler(),
        new AppTerminateHandler(),
        new AppReportRendererErrorHandler(),
        new AppGlobalStateGetHandler(),
        new AppGlobalStateSetHandler(),
        new AppGlobalStateGetAllHandler(),
        new AppAddRecentProjectHandler(),
        new AppRemoveRecentProjectHandler(),
        new AppRevealRecentProjectHandler(),
        new AppCheckRecentProjectsHandler(),
        new AppSystemPathHandler(),
        new AppExportDiagnosticsHandler(),
        new AppProbeDownloadSourceHandler(),
        new AppCacheInventoryHandler(),
        new AppCacheClearHandler(),
        new AppGlobalStateDeleteHandler(),
        new AppExportSettingsHandler(),
        new AppImportSettingsHandler(),

        new AppUpdateGetStateHandler(),
        new AppUpdateCheckHandler(),
        new AppUpdateDownloadHandler(),
        new AppUpdateInstallHandler(),

        new AppSettingsWindowLaunchHandler(),
        new AppCountWorkspaceWindowsHandler(),
        new AppRequestWorkspaceViewHandler(),
        new AppOpenExternalHandler(),
        new AppPickBackgroundImageHandler(),
        new AppReadBackgroundImageHandler(),

        // Spellchecker handlers
        new SpellcheckConfigureHandler(),
        new SpellcheckClearHandler(),
        new SpellcheckStatusHandler(),
        new SpellcheckCheckHandler(),
        new SpellcheckSuggestHandler(),
        new SpellcheckListInstalledHandler(),
        new SpellcheckListAvailableHandler(),
        new SpellcheckDownloadHandler(),
        new SpellcheckRemoveHandler(),

        // Project wizard handlers
        new ProjectWizardLaunchHandler(),
        new ProjectWizardSelectDirectoryHandler(),
        new ProjectWizardSelectPackageHandler(),
        new ProjectWizardGetDefaultDirectoryHandler(),

        // Workspace handlers
        new WorkspaceLaunchHandler(),
        new WorkspaceOpenRecentHandler(),
        new WorkspaceIsProjectOpenHandler(),
        new WorkspaceSelectFolderHandler(),
        new PsdOpenHandler(),
        new PsdBakeHandler(),
        new MediaProbeHandler(),
        new MediaConvertStartHandler(),
        new MediaConvertCancelHandler(),
        new MediaConvertGetStatusHandler(),
        new WorkspaceCloseHandler(),
        new WorkspaceExportProjectPackageHandler(),
        new WorkspaceImportProjectPackageHandler(),
        new WorkspaceExportConsoleLogsHandler(),
        new WorkspaceMenuSyncHandler(),
        new WorkspaceSetRecoveryModeHandler(),
        new WorkspaceOpenProjectFolderHandler(),
        new WorkspaceReportLoadResultHandler(),
        new WorkspaceReportWriteFreezeHandler(),

        // Dev mode handlers
        new DevModeLaunchHandler(),
        new DevModeStopHandler(),
        new DevModeReloadHandler(),
        new DevModeGetStatusHandler(),
        new DevModeFullscreenGetHandler(),
        new DevModeFullscreenSetHandler(),
        new DevModeOpenBlueprintInWorkspaceHandler(),
        new DevModeForwardBlueprintDebugEventHandler(),
        new DevModeForwardStoryRowHandler(),
        new DevModeOpenStoryRowInWorkspaceHandler(),
        new DevModeResolveAssetUrlHandler(),
        new DevModeResolveImageAssetUrlHandler(),
        new DevModeSaveWriteHandler(),
        new DevModeSaveReadHandler(),
        new DevModeSaveListIdsHandler(),
        new DevModeSaveListHeadersHandler(),
        new DevModeSaveReadPreviewHandler(),
        new DevModeSaveDeleteHandler(),

        // Preview runtime handlers
        new PreviewLaunchHandler(),
        new PreviewStopHandler(),
        new PreviewGetStatusHandler(),

        // Game sessions owned by a test run (not by the Run button)
        new GameTestLaunchHandler(),
        new GameTestStopHandler(),

        // Production game build handlers
        new GameBuildStartHandler(),
        new GameBuildCancelHandler(),
        new GameBuildGetStatusHandler(),
        new GameBuildSelectOutputDirHandler(),
        new GameBuildExportPatchHandler(),
        new GameBuildSelectPatchFileHandler(),
        new GameBuildPreflightHandler(),

        // Code-signing credential vault (machine-level; no handler returns a secret)
        new SigningListHandler(),
        new SigningImportHandler(),
        new SigningRemoveHandler(),
        new DistributionCreateKeyHandler(),
        new SigningInspectHandler(),
        new SigningKeystoreAliasesHandler(),
        new SigningMacIdentitiesHandler(),

        // Plugin build-config secrets (same vault; the value goes up, a handle comes back)
        new PluginBuildSecretSetHandler(),
        new PluginBuildSecretAvailableHandler(),

        // Blueprint persistent variable storage handlers
        new BlueprintPersistenceGetAllHandler(),
        new BlueprintPersistenceGetValueHandler(),
        new BlueprintPersistenceSetValueHandler(),
        new BlueprintPersistenceRemoveValueHandler(),

        // Blueprint network handler (the Fetch node)
        new BlueprintNetworkFetchHandler(),
        new BlueprintPointerMoveHandler(),

        // Blueprint external link handler (the Open Link node)
        new BlueprintExternalLinkOpenHandler(),
        new BlueprintExternalLinkOpenForPluginHandler(),

        // Blueprint progress handlers (the Export/Import Progress nodes)
        new BlueprintProgressWriteHandler(),
        new BlueprintProgressReadHandler(),

        // The server trust question, in a window of its own
        new ServerTrustPromptHandler(),

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
        new PluginLocaleListHandler(),
        new PluginRegistryFetchHandler(),
        new PluginRegistryIconHandler(),
        new PluginInstallFromRegistryHandler(),
        new UITemplateRegistryFetchHandler(),
        new UITemplateFetchBundleHandler(),
        new UITemplateFetchPreviewsHandler(),
        new UITemplateFetchThemePreviewsHandler(),
        new ProjectTemplateListHandler(),
        new ProjectTemplateScaffoldHandler(),
        new AssetFetchRemoteHandler(),
        new AssetExportToFolderHandler(),
        new PuppetRuntimeInstallSdkHandler(),

        // Actor-aware privileged facade handlers
        new PrivilegedFsCallHandler(),
        new PrivilegedPermissionRequestHandler(),
        new PrivilegedPermissionRevokePluginHandler(),
        new PrivilegedBashExecuteHandler(),

        // File system handlers
        new FsStatHandler(),
        new FsListHandler(),
        new FsDetailsHandler(),
        new FsDirectorySizeHandler(),
        new FsRequestReadHandler(),
        new FsRequestReadDirHandler(),
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

        // Version control (reads, the writes that only ever add a revision, and restore -
        // the one that overwrites the working tree. See docs/version-control.md)
        new VcsGetAvailabilityHandler(),
        new VcsIsRepositoryHandler(),
        new VcsGetInfoHandler(),
        new VcsInitRepositoryHandler(),
        new VcsCommitHandler(),
        new VcsCheckpointHandler(),
        new VcsRestoreRevisionHandler(),
        new VcsGetStatusHandler(),
        new VcsGetHistoryHandler(),
        new VcsReadBlobHandler(),
        new VcsReadWorkingFileHandler(),
        new VcsReadRevisionDocumentsHandler(),
        new VcsGetChangedPathsHandler(),
        new VcsDiffRevisionsHandler(),
        new VcsDiffWorkingTreeHandler(),
        new VcsGetThreeWayHandler(),
        new VcsGetMergeBaseHandler(),
        new VcsGetMergeStateHandler(),
        new VcsGetMergeDocumentHandler(),
        new VcsResolveConflictsHandler(),
        new VcsCompleteMergeHandler(),
        new VcsUnresolveConflictsHandler(),
        new VcsRestartConflictsHandler(),
        new VcsAbortMergeHandler(),
        new VcsGetRemoteHandler(),
        new VcsSetRemoteHandler(),
        new VcsGetServerSessionHandler(),
        new VcsSignInHandler(),
        new VcsProbeServerHandler(),
        new VcsListServersHandler(),
        new VcsListServerProjectsHandler(),
        new VcsCreateServerProjectHandler(),
        new VcsAddServerHandler(),
        new VcsForgetServerHandler(),
        new VcsSignOutHandler(),
        new VcsTrustAuthorityHandler(),
        new VcsGetSyncStateHandler(),
        new VcsPushHandler(),
        new VcsSyncHandler(),
        new VcsCloneHandler(),
    ] as IPCHandler<IPCEventType>[];
}
