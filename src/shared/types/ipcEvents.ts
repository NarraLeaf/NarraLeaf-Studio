import { FileDetails, FileStat, FileEntry, DirectorySizeResult } from "@shared/utils/fs";
import { AppInfo } from "./app";
import { IPCMessageType, IPCType } from "./ipc";
import { FsRequestResult, PlatformInfo } from "./os";
import type { FsTextEncoding } from "./textEncoding";
import { WindowAppType, WindowProps, WindowVisibilityStatus, WindowControlAbility, WindowCloseResults, WorkspaceViewRequest } from "./window";
import { GlobalStateKeys, GlobalStateValue } from "./state/globalState";
import type { MissingRecentProject } from "./state/appStateTypes";
import { DevModeBlueprintDebugEventPayload, DevModeBundle, DevModeConsoleLogPayload, DevModeEntry, DevModeStatus, DevModeStoryRowHighlight, DevModeStoryRowOpenPayload, DevModeStoryRowOpenRequest, DevModeStoryRowPayload } from "./devMode";
import type { GameRuntimeLaunchEntry, PreviewStatus } from "./gameRuntime";
import type { GameTestEventPayload, GameTestLaunchRequest, GameTestLaunchResult } from "./gameTest";
import type { BuildPreflightFinding, GameBuildRequest, GameBuildStateSnapshot } from "./gameBuild";
import type { BlueprintDebugEvent } from "./blueprint/debug";
import type { BlueprintOpenExternalRequest, BlueprintOpenExternalResult } from "./blueprint/externalLink";
import type {
    GameProgressExportRequest,
    GameProgressExportResult,
    GameProgressImportResult,
} from "./gameProgress";
import type { BlueprintNetworkFetchRequest, BlueprintNetworkFetchResult } from "./blueprint/network";
import type { DevModeSaveProjectRef, DevModeSaveRecord } from "./devModeSave";
import type { PreviewStudioBlueprintOpenPayload } from "./previewStudioBlueprintOpen";
import type { PluginPermissionGrantPayload, PluginPermissionGrantResult, PluginPermissionPromptResult } from "./pluginPermissions";
import type {
    PluginApproveResult,
    PluginInstallResult,
    PluginListItem,
    RuntimePluginDescriptor,
    WorkspacePluginDescriptor,
} from "./plugins";
import type { CacheClearResult, CacheInventoryReport } from "./cacheInventory";
import type { UpdateState } from "@shared/constants/update";
import type { MediaConvertRequest, MediaConvertStateSnapshot } from "./mediaConvert";
import type { MediaProbeOutcome } from "./mediaProbe";
import type { PluginRegistryFetchResult } from "./pluginRegistry";
import type { PuppetRuntimeInstallResult } from "./puppetRuntime";
import type { UITemplateBundle, UITemplateFetchResult, UITemplatePreview, UIThemePreview } from "./uiTemplateRegistry";
import type { ProjectTemplateDescriptor } from "./projectTemplate";
import type { RemoteAssetFetchResult, RemoteAssetValidators } from "./remoteAsset";
import type { SpellcheckContextMenuPayload, SpellcheckStatus } from "./spellcheck";
import type { AssetExportEntry, AssetExportResult } from "./assetExport";
import type { LocaleContribution } from "@shared/i18n";
import type {
    PrivilegedBashExecutePayload,
    PrivilegedBashExecuteResult,
    PrivilegedFileSystemCallPayload,
    PrivilegedFileSystemCallResult,
    PrivilegedPermissionRevokePluginPayload,
    PrivilegedPermissionRequestPayload,
} from "./privileged";
import type {
    EditMenuRole,
    MenuActionId,
    NativeMenuModel,
} from "./menu";
import type { PsdBakeRequest, PsdBakedLayer, PsdDocument } from "./psdImport";
import type {
    SigningCredential,
    MacSigningIdentity,
    SigningCredentialImport,
    SigningInspectResult,
} from "./signing";
import type {
    RevisionId,
    VcsAvailability,
    VcsBlobRequest,
    VcsCheckpointReason,
    VcsCommitOptions,
    VcsCommitResult,
    VcsConflictChoice,
    VcsHistoryEntry,
    VcsInitOptions,
    VcsMergeCompletion,
    VcsMergeDecision,
    VcsMergeDocument,
    VcsMergeResolveResult,
    VcsMergeState,
    VcsRepositoryInfo,
    VcsRestoreOptions,
    VcsRestoreResult,
    VcsPushResult,
    VcsServerProbe,
    VcsServerSession,
    VcsRevisionDiffResult,
    VcsStatus,
    VcsSyncResult,
    VcsAddServerOutcome,
    VcsSignInOutcome,
    VcsSyncState,
    VcsThreeWayResult,
    VcsWorkingFileRead,
    VcsWorkingFileRequest,
    VcsWorkingTreeDiffResult,
} from "./vcs";

export enum IPCEventType {
    getPlatform = "getPlatform",
    appTerminate = "app.terminate",
    appWindowControl = "app.window.setControl",
    appDetachedWindowControl = "app.window.detachedControl",
    appWindowEditCommand = "app.window.editCommand",
    appWindowClose = "app.window.close",
    appWindowCloseWith = "app.window.closeWith",
    appWindowGetControl = "app.window.getControl",
    appWindowControlAbility = "app.window.getControlAbility",
    appWindowGetFullscreen = "app.window.getFullscreen",
    appWindowFullscreenChanged = "app.window.fullscreenChanged",
    appWindowProps = "app.window.props",
    appInfo = "app.info",
    appWindowReady = "app.window.ready",
    appLaunchSettings = "app.settings.launchWindow",
    appCountWorkspaceWindows = "app.countWorkspaceWindows",
    appRequestWorkspaceView = "app.requestWorkspaceView",
    appOpenExternal = "app.openExternal",
    spellcheckConfigure = "app.spellcheck.configure",
    spellcheckClear = "app.spellcheck.clear",
    spellcheckStatus = "app.spellcheck.status",
    spellcheckReplaceMisspelling = "app.spellcheck.replaceMisspelling",
    spellcheckContextMenu = "app.spellcheck.contextMenu",
    appPickBackgroundImage = "app.pickBackgroundImage",
    appReadBackgroundImage = "app.readBackgroundImage",
    appGlobalStateGet = "app.globalState.get",
    appGlobalStateSet = "app.globalState.set",
    appGlobalStateGetAll = "app.globalState.getAll",
    appGlobalStateChanged = "app.globalState.changed",
    appAddRecentProject = "app.addRecentProject",
    appRemoveRecentProject = "app.removeRecentProject",
    appRevealRecentProject = "app.revealRecentProject",
    appCheckRecentProjects = "app.checkRecentProjects",
    appSystemPath = "app.systemPath",
    appExportDiagnostics = "app.exportDiagnostics",
    appProbeDownloadSource = "app.probeDownloadSource",
    appCacheInventory = "app.cacheInventory",
    appCacheClear = "app.cacheClear",
    appGlobalStateDelete = "app.globalState.delete",
    appExportSettings = "app.exportSettings",
    appImportSettings = "app.importSettings",
    appUpdateGetState = "app.update.getState",
    appUpdateCheck = "app.update.check",
    appUpdateDownload = "app.update.download",
    appUpdateInstall = "app.update.install",
    appUpdateStateChanged = "app.update.stateChanged",

    fsStat = "fs.stat",
    fsList = "fs.list",
    fsDetails = "fs.details",
    fsDirectorySize = "fs.directorySize",
    fsRequestRead = "fs.requestRead",
    fsRequestReadDir = "fs.requestReadDir",
    fsRequestWrite = "fs.requestWrite",
    fsEnsureRegularFile = "fs.ensureRegularFile",
    fsWriteFileNoFollow = "fs.writeFileNoFollow",
    fsRecoverCorruptedJsonFile = "fs.recoverCorruptedJsonFile",
    fsCreateDir = "fs.createDir",
    fsDeleteFile = "fs.deleteFile",
    fsDeleteDir = "fs.deleteDir",
    fsRename = "fs.rename",
    fsCopyFile = "fs.copyFile",
    fsCopyDir = "fs.copyDir",
    fsMoveFile = "fs.moveFile",
    fsMoveDir = "fs.moveDir",
    fsFileExists = "fs.fileExists",
    fsDirExists = "fs.dirExists",
    fsIsFile = "fs.isFile",
    fsIsDir = "fs.isDir",
    fsSelectFile = "fs.selectFile",
    fsSelectDirectory = "fs.selectDirectory",
    fsGrantFileAccess = "fs.grantFileAccess",
    fsHash = "fs.hash",

    editorLaunch = "editor.launch",

    projectWizardLaunch = "projectWizard.launch",
    projectWizardSelectDirectory = "projectWizard.selectDirectory",
    projectWizardSelectPackage = "projectWizard.selectPackage",
    projectWizardGetDefaultDirectory = "projectWizard.getDefaultDirectory",
    
    workspaceLaunch = "workspace.launch",
    workspaceOpenRecent = "workspace.openRecent",
    workspaceSelectFolder = "workspace.selectFolder",
    workspaceClose = "workspace.close",
    psdOpen = "psd.open",
    psdBake = "psd.bake",
    mediaProbe = "media.probe",
    mediaConvertStart = "media.convert.start",
    mediaConvertCancel = "media.convert.cancel",
    mediaConvertGetStatus = "media.convert.getStatus",
    workspaceExportProjectPackage = "workspace.projectPackage.export",
    workspaceImportProjectPackage = "workspace.projectPackage.import",
    workspaceExportConsoleLogs = "workspace.console.exportLogs",
    workspaceSetRecoveryMode = "workspace.setRecoveryMode",
    workspaceOpenProjectFolder = "workspace.openProjectFolder",
    workspaceConfirmClose = "workspace.confirmClose",
    workspaceCloseProgress = "workspace.closeProgress",
    workspaceFlushPendingSaves = "workspace.flushPendingSaves",
    workspaceResolveAssetUrl = "workspace.resolveAssetUrl",
    workspaceResolveImageAssetUrl = "workspace.resolveImageAssetUrl",
    workspaceReportWriteFreeze = "workspace.reportWriteFreeze",
    workspaceBlueprintNavigateFromPreview = "workspace.blueprint.navigateFromPreview",
    workspaceBlueprintDebugEvent = "workspace.blueprint.debugEvent",
    workspaceDevModeConsoleLog = "workspace.devMode.consoleLog",
    workspaceStoryRowHighlight = "workspace.storyRow.highlight",
    workspaceStoryRowOpen = "workspace.storyRow.open",
    
    devModeLaunch = "devMode.launch",
    devModeStop = "devMode.stop",
    devModeReload = "devMode.reload",
    devModeGetStatus = "devMode.getStatus",
    devModePayloadUpdate = "devMode.payload.update",
    devModeControlReload = "devMode.control.reload",
    devModeControlError = "devMode.control.error",
    devModeResolveAssetUrl = "devMode.resolveAssetUrl",
    devModeResolveImageAssetUrl = "devMode.resolveImageAssetUrl",
    devModeOpenBlueprintInWorkspace = "devMode.openBlueprintInWorkspace",
    devModeForwardBlueprintDebugEvent = "devMode.blueprintDebug.forward",
    devModeForwardStoryRow = "devMode.storyRow.forward",
    devModeOpenStoryRowInWorkspace = "devMode.storyRow.openInWorkspace",
    devModeSaveWrite = "devMode.save.write",
    devModeSaveRead = "devMode.save.read",
    devModeSaveListIds = "devMode.save.listIds",
    devModeSaveReadPreview = "devMode.save.readPreview",
    devModeSaveDelete = "devMode.save.delete",
    devModeFullscreenGet = "devMode.fullscreen.get",
    devModeFullscreenSet = "devMode.fullscreen.set",
    devModeFullscreenChanged = "devMode.fullscreen.changed",
    devModeWindowCloseRequested = "devMode.window.closeRequested",

    previewLaunch = "preview.launch",
    previewStop = "preview.stop",
    previewGetStatus = "preview.getStatus",

    gameTestLaunch = "gameTest.launch",
    gameTestStop = "gameTest.stop",
    /** Pushed, unlike preview's polled status: event ordering is evidence a test reasons about. */
    workspaceGameTestEvent = "workspace.gameTest.event",

    gameBuildStart = "gameBuild.start",
    gameBuildCancel = "gameBuild.cancel",
    gameBuildGetStatus = "gameBuild.getStatus",
    gameBuildSelectOutputDir = "gameBuild.selectOutputDir",
    gameBuildPreflight = "gameBuild.preflight",

    signingList = "signing.list",
    signingImport = "signing.import",
    signingRemove = "signing.remove",
    signingInspect = "signing.inspect",
    signingKeystoreAliases = "signing.keystoreAliases",
    signingMacIdentities = "signing.macIdentities",

    pluginBuildSecretSet = "pluginBuildSecret.set",
    pluginBuildSecretAvailable = "pluginBuildSecret.available",

    blueprintPersistenceGetAll = "blueprintPersistence.getAll",
    blueprintPersistenceGetValue = "blueprintPersistence.getValue",
    blueprintPersistenceSetValue = "blueprintPersistence.setValue",
    blueprintPersistenceRemoveValue = "blueprintPersistence.removeValue",
    blueprintNetworkFetch = "blueprintNetwork.fetch",
    blueprintExternalLinkOpen = "blueprintExternalLink.open",
    blueprintExternalLinkOpenForPlugin = "blueprintExternalLink.openForPlugin",
    blueprintProgressWrite = "blueprintProgress.write",
    blueprintProgressRead = "blueprintProgress.read",

    serverTrustPrompt = "serverTrust.prompt",

    pluginPermissionPromptLaunch = "plugin.permissionPrompt.launch",
    pluginPermissionGrant = "plugin.permission.grant",
    pluginList = "plugin.list",
    pluginInstallLocal = "plugin.installLocal",
    pluginSetEnabled = "plugin.setEnabled",
    pluginApprove = "plugin.approve",
    pluginUninstall = "plugin.uninstall",
    pluginRevoke = "plugin.revoke",
    pluginWorkspaceList = "plugin.workspaceList",
    pluginRuntimeList = "plugin.runtimeList",
    pluginReportLoadError = "plugin.reportLoadError",
    pluginLocaleList = "plugin.localeList",
    pluginLocalesChanged = "plugin.localesChanged",
    pluginRegistryFetch = "plugin.registryFetch",
    pluginRegistryIcon = "plugin.registryIcon",
    pluginInstallFromRegistry = "plugin.installFromRegistry",

    uiTemplateRegistryFetch = "uiTemplate.registryFetch",
    uiTemplateFetchBundle = "uiTemplate.fetchBundle",
    uiTemplateFetchPreviews = "uiTemplate.fetchPreviews",
    uiTemplateFetchThemePreviews = "uiTemplate.fetchThemePreviews",
    projectTemplateList = "projectTemplate.list",
    projectTemplateScaffold = "projectTemplate.scaffold",

    assetFetchRemote = "asset.fetchRemote",
    assetExportToFolder = "asset.exportToFolder",

    puppetRuntimeInstallSdk = "puppetRuntime.installSdk",

    privilegedFsCall = "privileged.fs.call",
    privilegedPermissionRequest = "privileged.permission.request",
    privilegedPermissionRevokePlugin = "privileged.permission.revokePlugin",
    privilegedBashExecute = "privileged.bash.execute",

    menuAction = "app.menu.action",
    workspaceMenuSync = "workspace.menu.sync",
    workspaceReportLoadResult = "workspace.reportLoadResult",
    workspaceOpenView = "workspace.openView",
    settingsHighlight = "settings.highlight",

    vcsGetAvailability = "vcs.getAvailability",
    vcsGetInfo = "vcs.getInfo",
    vcsIsRepository = "vcs.isRepository",
    vcsInitRepository = "vcs.initRepository",
    vcsCommit = "vcs.commit",
    vcsCheckpoint = "vcs.checkpoint",
    vcsRestoreRevision = "vcs.restoreRevision",
    vcsGetStatus = "vcs.getStatus",
    vcsGetHistory = "vcs.getHistory",
    vcsReadBlob = "vcs.readBlob",
    vcsReadWorkingFile = "vcs.readWorkingFile",
    vcsReadRevisionDocuments = "vcs.readRevisionDocuments",
    vcsGetChangedPaths = "vcs.getChangedPaths",
    vcsDiffRevisions = "vcs.diffRevisions",
    vcsDiffWorkingTree = "vcs.diffWorkingTree",
    vcsGetThreeWay = "vcs.getThreeWay",
    vcsGetMergeBase = "vcs.getMergeBase",
    vcsGetMergeState = "vcs.getMergeState",
    vcsGetMergeDocument = "vcs.getMergeDocument",
    vcsResolveConflicts = "vcs.resolveConflicts",
    vcsCompleteMerge = "vcs.completeMerge",
    vcsUnresolveConflicts = "vcs.unresolveConflicts",
    vcsRestartConflicts = "vcs.restartConflicts",
    vcsAbortMerge = "vcs.abortMerge",
    vcsGetRemote = "vcs.getRemote",
    vcsSetRemote = "vcs.setRemote",
    vcsGetSyncState = "vcs.getSyncState",
    vcsGetServerSession = "vcs.getServerSession",
    vcsSignIn = "vcs.signIn",
    vcsSignOut = "vcs.signOut",
    vcsProbeServer = "vcs.probeServer",
    vcsListServers = "vcs.listServers",
    vcsAddServer = "vcs.addServer",
    vcsForgetServer = "vcs.forgetServer",
    vcsTrustAuthority = "vcs.trustAuthority",
    vcsPush = "vcs.push",
    vcsSync = "vcs.sync",
    vcsClone = "vcs.clone",
}

export type VoidRequestStatus = RequestStatus<void>;
export type RequestStatus<T> = {
    success: true;
    data: T;
    error?: never;
    code?: never;
} | {
    success: false;
    data?: never;
    /**
     * What went wrong, as a sentence. Written in English by whoever threw, and rendered verbatim
     * wherever no {@link code} identifies it - which is the right default for a backend refusal
     * that names its own remedy, and the wrong one for a situation the interface has words for.
     */
    error?: string;
    /**
     * A stable identifier for a failure the renderer is expected to recognise, when the thrower
     * gave itself one (`error.code`).
     *
     * Optional and additive: everything that threw a plain `Error` before still arrives with
     * `error` alone and is shown as it always was. It exists because the alternative is matching
     * on English prose - the renderer's only way to tell "nothing has changed since the last
     * version", which is an ordinary answer, from a real failure - and prose is what gets reworded.
     */
    code?: string;
};

export type BlueprintPersistenceProjectRef = {
    projectIdentifier?: string;
    projectPath: string;
};

/**
 * Why a workspace is frozen, as it travels to main - the `kind` of the renderer's
 * `WorkspaceFreezeReason` and nothing else.
 *
 * Only the kind crosses, because main only needs it to pick the sentence it tells the author
 * ("leave the revision" vs "unfreeze"). The revision id and label are the renderer's business.
 * A third kind added to the reason will fail to compile at the reporting call site, which is the
 * right place to be asked what to say about it.
 */
export type WorkspaceFreezeKind = "revision" | "manual" | "merge" | "recovery";

/**
 * Which part of the close a workspace is currently waiting on.
 *
 * The close is a sequence of waits the author cannot see - the last auto-saves going out, then
 * Lore writing the closing checkpoint, which is the long one - and until this existed the window
 * simply sat there for those seconds with the title bar still on screen.
 *
 * Named stages rather than a fraction because none of the steps can report a fraction: the
 * checkpoint is one call into the backend that answers when it answers. Naming what is happening
 * is the honest amount of detail, and it is also the part that answers "why is this taking so
 * long" - "recording a version" is a reason, "43%" is not.
 */
export type WorkspaceCloseStage = "saving" | "checkpoint" | "launcher";

export type IPCEvents = {
    [IPCEventType.getPlatform]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: PlatformInfo;
    };
    [IPCEventType.appTerminate]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: {
            err: string | null;
        },
        response: never;
    };
    [IPCEventType.appWindowControl]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            control: "minimize" | "maximize" | "unmaximize" | "close",
        },
        response: void;
    };
    /**
     * Run a built-in webContents editing command (copy/cut/paste/delete) on the sending window.
     * Used by the renderer when a native Edit-menu command routed to a surface action should
     * fall back to normal text editing because the user is in a text field.
     */
    /**
     * Drive one of the sending window's DETACHED windows (see `detachedWindowGuard`).
     *
     * A detached window is frameless and wears the editor's own title row as its title bar, so its
     * minimise / maximise / close buttons are drawn by the renderer - but that renderer is the
     * opener's, and every other window-control call resolves to "the window that sent this IPC".
     * Sent blind, those buttons would drive the workspace window instead of the one they are drawn
     * in. Hence the key: the popup names itself, and the main process looks it up among the
     * children of the sender, which is also what stops a window from reaching another's.
     */
    [IPCEventType.appDetachedWindowControl]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            /** The detached window's key, as given to `window.open`'s frame name. */
            key: string,
            /** `status` only reads; the rest act and then report where the window ended up. */
            control: "status" | "minimize" | "toggleMaximize" | "close",
        },
        response: {
            status: WindowVisibilityStatus,
        };
    };
    [IPCEventType.appWindowEditCommand]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: {
            command: EditMenuRole,
        },
        response: never;
    };
    [IPCEventType.appWindowClose]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: {},
        response: never;
    };
    [IPCEventType.appWindowCloseWith]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: {
            result: WindowCloseResults[WindowAppType];
        },
        response: never;
    };
    [IPCEventType.appWindowGetControl]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            status: WindowVisibilityStatus,
        };
    };
    [IPCEventType.appWindowControlAbility]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: WindowControlAbility;
    };
    [IPCEventType.appWindowGetFullscreen]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            isFullscreen: boolean,
        };
    };
    [IPCEventType.appWindowFullscreenChanged]: {
        type: IPCMessageType.message,
        consumer: IPCType.Client,
        data: { isFullscreen: boolean },
        response: never;
    };
    [IPCEventType.appWindowProps]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: WindowProps[WindowAppType];
    };
    [IPCEventType.appInfo]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: AppInfo;
    };
    [IPCEventType.appWindowReady]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: {},
        response: never;
    };
    [IPCEventType.appLaunchSettings]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            props: WindowProps[WindowAppType.Settings];
        },
        response: void;
    };
    [IPCEventType.appCountWorkspaceWindows]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: Record<string, never>,
        response: {
            count: number;
        };
    };
    [IPCEventType.appRequestWorkspaceView]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            view: WorkspaceViewRequest;
        },
        response: {
            /** False when no workspace window was open to receive it. */
            delivered: boolean;
        };
    };
    [IPCEventType.appOpenExternal]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            url: string;
        },
        response: void;
    };
    /**
     * Hand the session this window's project: the language its script is written in, and the words
     * that project spells on purpose. Answers what spellchecking ended up doing, which is more than
     * the caller asked for - the language may have no dictionary at all.
     */
    [IPCEventType.spellcheckConfigure]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            sourceLocale: string;
            words: string[];
        },
        response: SpellcheckStatus;
    };
    /** Take this project's words back out of the session, so the next project does not inherit them. */
    [IPCEventType.spellcheckClear]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: Record<string, never>,
        response: void;
    };
    /** What spellchecking is doing now. Read by the Settings window, which has no project of its own. */
    [IPCEventType.spellcheckStatus]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: Record<string, never>,
        response: SpellcheckStatus;
    };
    /** Put `text` in place of the misspelling the context menu was opened on. */
    [IPCEventType.spellcheckReplaceMisspelling]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            text: string;
        },
        response: void;
    };
    /**
     * A right click landed on editable text, with whatever the spellchecker knows about the word
     * under it. Pushed because that verdict exists only in the main process: the renderer can see
     * the word but has no way to ask whether it is spelled correctly.
     */
    [IPCEventType.spellcheckContextMenu]: {
        type: IPCMessageType.message,
        consumer: IPCType.Client,
        data: SpellcheckContextMenuPayload,
        response: never;
    };
    [IPCEventType.appPickBackgroundImage]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: Record<string, never>,
        response: {
            /** Stored filename inside userData/backgrounds, or null when the dialog was cancelled. */
            file: string | null;
        };
    };
    [IPCEventType.appReadBackgroundImage]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            file: string;
        },
        response: {
            data: Uint8Array | null;
        };
    };
    [IPCEventType.appGlobalStateGet]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            key: GlobalStateKeys;
        },
        response: {
            value: GlobalStateValue<GlobalStateKeys>;
        };
    };
    [IPCEventType.appGlobalStateSet]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            key: GlobalStateKeys;
            value: GlobalStateValue<GlobalStateKeys>;
        },
        response: void;
    };
    [IPCEventType.appGlobalStateGetAll]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            settings: Record<string, any>;
        };
    };
    // Host -> renderer push: fired for every window whenever any global-state key
    // changes, so live views (e.g. the active i18n locale) can react in place.
    [IPCEventType.appGlobalStateChanged]: {
        type: IPCMessageType.message,
        consumer: IPCType.Client,
        data: {
            key: GlobalStateKeys;
            value: GlobalStateValue<GlobalStateKeys>;
        },
        response: never;
    };
    [IPCEventType.appAddRecentProject]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            name: string;
            path: string;
        },
        response: void;
    };
    /**
     * Remove one entry. Takes the path rather than the resulting list: the main process owns the
     * read-modify-write, so a stale renderer snapshot cannot erase another window's changes.
     */
    [IPCEventType.appRemoveRecentProject]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: void;
    };
    /**
     * Show one remembered project's folder in the OS file manager.
     *
     * Takes a path, unlike its workspace counterpart, because the launcher has no project of its
     * own - the list is what it acts on. The host still refuses any path that is not in the
     * history, so this is a "reveal one of these", never a "reveal anything".
     */
    [IPCEventType.appRevealRecentProject]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: void;
    };
    /**
     * Check every remembered project against the disk and report the ones that are gone.
     *
     * Takes no paths: the main process reads the history itself, so a renderer cannot use this to
     * probe arbitrary parts of the file system for existence.
     */
    [IPCEventType.appCheckRecentProjects]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            missing: MissingRecentProject[];
        };
    };
    [IPCEventType.appSystemPath]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            name: "desktop" | "home";
        },
        response: {
            path: string;
        };
    };
    /**
     * Write a support bundle - the caller's own report plus the main-process log tail - to a file
     * the user picks.
     *
     * The renderer supplies only the half it can see (what went wrong, what it had loaded, its own
     * recent console lines); the environment header and the log tail are read here, because
     * `<userData>/logs` is Studio storage that no renderer is granted. Exists on the base surface
     * rather than the workspace one on purpose: the window that most needs it is the one whose
     * workspace failed to start, and that window has no services to route a workspace call through.
     */
    [IPCEventType.appExportDiagnostics]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            /** Suggested file name, without a directory. Sanitized before use. */
            defaultFileName: string;
            /** The renderer's section of the bundle, already formatted. */
            report: string;
        },
        response: {
            canceled: boolean;
            filePath?: string;
            byteLength?: number;
        };
    };
    /**
     * Ask the host whether a mirror answers, for the Network settings panel.
     *
     * In main because the renderer never touches the network - not even to check a URL the user
     * typed. A HEAD that gets any HTTP response proves the host is there, which is the whole
     * question; the same reasoning `probePluginBuildDependency` gives for not treating a 405 as
     * an outage applies, so the status is reported rather than judged.
     */
    [IPCEventType.appProbeDownloadSource]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            /** The address to probe. Refused unless it parses as https. */
            url: string;
        };
        response: {
            /** True when the host answered at all, whatever it said. */
            reachable: boolean;
            /** HTTP status when there was a response. */
            status?: number;
            /** Transport-level failure, or why the URL was refused. */
            error?: string;
        };
    };
    /** Sizes of the caches Studio can throw away. Measured on demand; see `cacheInventory`. */
    [IPCEventType.appCacheInventory]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: Record<string, never>;
        response: CacheInventoryReport;
    };
    /** Empty the named cache buckets. Ids the host does not know come back under `failed`. */
    [IPCEventType.appCacheClear]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { ids: string[] };
        response: CacheClearResult;
    };
    /**
     * Remove stored values, so the next read resolves the default.
     *
     * A separate channel from `set` because writing the default over a key is NOT the same
     * thing: the keys with no entry in GLOBAL_STATE_DEFAULTS resolve a fallback their reader
     * computes (a device locale, a clamped range), and only absence gets them there. Main
     * refuses anything on the protected list, so a renderer bug cannot take the project
     * history or the per-project statistics with it.
     */
    [IPCEventType.appGlobalStateDelete]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { keys: string[] };
        response: {
            /** Keys that had a stored value and no longer do. */
            deleted: string[];
            /** Keys refused because they are not preferences. */
            refused: string[];
        };
    };
    /**
     * The updater's current state. Requested once when a surface mounts; every change after that
     * arrives on `appUpdateStateChanged` rather than by polling, so a progress bar is showing the
     * downloader's own byte counts.
     */
    [IPCEventType.appUpdateGetState]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: Record<string, never>;
        response: { state: UpdateState };
    };
    /** Ask whether a newer release exists. Never starts a download - see `appUpdateDownload`. */
    [IPCEventType.appUpdateCheck]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: Record<string, never>;
        response: { state: UpdateState };
    };
    /**
     * Start downloading the offered installer.
     *
     * Separate from the check because they are separate decisions: the check is free, the
     * download is a few hundred megabytes. Only the Settings panel calls this - the notification
     * that announces an update opens the panel instead, so nobody commits to the transfer from a
     * toast they were half-reading.
     */
    [IPCEventType.appUpdateDownload]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: Record<string, never>;
        response: { state: UpdateState };
    };
    /** Quit and apply the downloaded installer. Silent, so the wizard is not walked again. */
    [IPCEventType.appUpdateInstall]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: Record<string, never>;
        response: void;
    };
    /** Write a settings document to a file the user picks. See `@shared/utils/settingsDocument`. */
    [IPCEventType.appExportSettings]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            defaultFileName: string;
            /** The document, already composed and serialized by the renderer. */
            content: string;
        };
        response: { canceled: boolean; filePath?: string };
    };
    /** Read a settings document the user picks. Parsing and validation happen in the renderer. */
    [IPCEventType.appImportSettings]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: Record<string, never>;
        response: { canceled: boolean; filePath?: string; content?: string };
    };
} & IPCMenuEvents & IPCFsEvents & IPCEditorEvents & IPCProjectWizardEvents & IPCWorkspaceEvents & IPCDevModeEvents & IPCPreviewEvents & IPCGameTestEvents & IPCGameBuildEvents & IPCSigningEvents & IPCPluginBuildSecretEvents & IPCBlueprintPersistenceEvents & IPCPluginPermissionEvents & IPCPluginManagerEvents & IPCUITemplateEvents & IPCAssetEvents & IPCPrivilegedEvents & IPCVcsEvents & IPCServerTrustEvents;

/**
 * Version control. Every event carries `projectPath`: Studio is
 * one-project-one-window and the VCS runtime is keyed per project, so an event
 * without it would be ambiguous the moment two projects are open.
 *
 * Blobs cross as base64 rather than Buffer - structured clone would turn a
 * Buffer into a Uint8Array on the renderer side anyway, and base64 keeps the
 * contract explicit.
 */
export type IPCVcsEvents = {
    /**
     * Ask this FIRST. Version control is optional - there is no native build for
     * macOS Intel or Windows ARM64 - and every other VCS call fails on a host
     * without one. Branch the UI on this, do not probe by catching errors.
     */
    [IPCEventType.vcsGetAvailability]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: Record<string, never>,
        response: VcsAvailability;
    };
    [IPCEventType.vcsIsRepository]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string },
        response: { isRepository: boolean };
    };
    [IPCEventType.vcsGetInfo]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string },
        response: VcsRepositoryInfo;
    };
    /**
     * Create the repository and its first commit. The one write here, and only
     * because nothing else works until it has happened - see vcsAction.ts.
     */
    [IPCEventType.vcsInitRepository]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; options?: VcsInitOptions },
        response: VcsRepositoryInfo;
    };
    /**
     * Record the working tree as a new revision.
     *
     * Long: it settles the renderer's auto-save debt, stages the whole project, commits,
     * and forces Lore's stores to disk before answering, because a commit reported before
     * that flush is a commit that may not survive the process. Await it, and show the
     * failure - "nothing has changed" arrives here as one, and it is the answer.
     */
    [IPCEventType.vcsCommit]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; options?: VcsCommitOptions },
        response: VcsCommitResult;
    };
    /**
     * Record a checkpoint - the same revision, labelled as one Studio took rather than
     * one the author asked for.
     *
     * `revision: null` means there was nothing to record: the project is not under
     * version control, this host has no backend, or the tree has not changed since the
     * last revision. None of those are failures, and an empty revision every interval
     * would make the history unreadable.
     */
    [IPCEventType.vcsCheckpoint]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; reason: VcsCheckpointReason },
        response: { revision: VcsCommitResult | null };
    };
    /**
     * Put the working tree back to one revision and record the result as a new one.
     *
     * The only call in this map that OVERWRITES the author's files, so two properties are part of the
     * contract rather than implementation detail: a checkpoint is taken before anything is written
     * (and a failure to take it aborts the whole thing), and nothing between the target revision and
     * the head is removed - restoring adds a revision, it never rewinds.
     *
     * Long, for the same reasons a commit is, twice over: it settles the renderer's save debt, reads
     * the revision (over the network on a project with a remote), commits a checkpoint, rewrites the
     * working tree, and commits again. The caller must leave the revision view and re-read every
     * document afterwards - the bytes under the editors have changed.
     */
    [IPCEventType.vcsRestoreRevision]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; revision: RevisionId; options?: VcsRestoreOptions },
        response: VcsRestoreResult;
    };
    /**
     * What changed in the working tree. NOT a pure read - the scan behind it records
     * newly discovered directories into staged state, so a caller that polls this on
     * a timer manufactures deletions the author never made (docs §4.17). Call it when
     * someone asks, never on a schedule.
     */
    [IPCEventType.vcsGetStatus]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string },
        response: VcsStatus;
    };
    /**
     * Revisions, newest first. `includeDetails` costs one backend call per revision -
     * there is no batch metadata verb - so it is opt-in, and entries come back without
     * a `kind` when it is off.
     *
     * That one call returns the whole metadata map, so the flag also fills in `message`,
     * `timestamp` and `author` at no extra cost. All four stay optional: a revision is
     * not obliged to carry any of them.
     */
    [IPCEventType.vcsGetHistory]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; limit?: number; includeDetails?: boolean },
        response: { entries: VcsHistoryEntry[] };
    };
    [IPCEventType.vcsReadBlob]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: VcsBlobRequest,
        response: { contentBase64: string };
    };
    /**
     * The same file as the working tree holds it now - the other side of a comparison.
     *
     * Narrow on purpose: one versioned path, under a size ceiling, and nothing else. See
     * `managers/vcs/workingFile.ts` for what it refuses and why each refusal is a refusal
     * rather than an empty answer.
     */
    [IPCEventType.vcsReadWorkingFile]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: VcsWorkingFileRequest,
        response: VcsWorkingFileRead;
    };
    /**
     * Every document at one revision, in one round trip.
     *
     * Batched rather than one call per path because the first read of a revision on a
     * project with a remote goes to the network (docs/version-control.md §6). Omitting
     * `paths` asks for whatever the revision holds that looks like a document; naming
     * them asks for exactly those, and `contentBase64: null` means the revision does not
     * contain that path - which is an answer, not a failure.
     */
    [IPCEventType.vcsReadRevisionDocuments]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; revision: RevisionId; paths?: string[] },
        response: { documents: { path: string; contentBase64: string | null }[] };
    };
    [IPCEventType.vcsGetChangedPaths]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; from: RevisionId; to: RevisionId },
        response: { paths: string[] };
    };
    /**
     * What changed between two revisions, as changes rather than as bytes.
     *
     * Cached in the main process per pair, which it may be because revisions are immutable.
     * `complete: false` means a budget stopped it short and the surface has to say so;
     * `readFailure` means the bytes could not be fetched at all, which is a different fact
     * from "nothing changed" and looks identical if it is ignored.
     */
    [IPCEventType.vcsDiffRevisions]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; from: RevisionId; to: RevisionId },
        response: VcsRevisionDiffResult;
    };
    /**
     * What the author has changed since the last version.
     *
     * **Never cached anywhere**, because the working tree changes under Studio between any
     * two calls. It also SCANS (docs §4.17), so it must be asked because someone wants to
     * know and never on a timer - a poll manufactures deletions the author never made.
     */
    [IPCEventType.vcsDiffWorkingTree]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string },
        response: VcsWorkingTreeDiffResult;
    };
    [IPCEventType.vcsGetThreeWay]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; mine: RevisionId; theirs: RevisionId; path: string },
        response: VcsThreeWayResult;
    };
    [IPCEventType.vcsGetMergeBase]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; a: RevisionId; b: RevisionId },
        response: { base?: RevisionId };
    };
    /**
     * Whether a merge is open here, and which paths are still unsettled.
     *
     * Worth asking on project open and not only after a sync: a merge is repository
     * state and survives closing the window (docs §4.23-§4.24).
     */
    [IPCEventType.vcsGetMergeState]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string },
        response: VcsMergeState;
    };
    /**
     * The three-way merge of ONE conflicted document, change by change - tier two.
     *
     * A pure read of the three copies the merge left beside the file (docs §4.23); it records
     * nothing and remembers nothing, so a settled change and an unsettled one look the same here
     * exactly as they do everywhere else in a merge (§4.24).
     *
     * Every reason a document cannot be settled this way comes back as `blocked` rather than as a
     * failure: most paths have no spec, most specs have no `merge3`, and a spec that has one may
     * still refuse to write itself back. All three keep the path at tier one, visibly.
     */
    [IPCEventType.vcsGetMergeDocument]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; path: string },
        response: VcsMergeDocument;
    };
    /**
     * **Records nothing** - the merge stays open until a commit closes it. `mine` and
     * `theirs` overwrite the working tree, so re-read the paths afterwards.
     */
    [IPCEventType.vcsResolveConflicts]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; paths: string[]; choice: VcsConflictChoice },
        response: VcsMergeResolveResult;
    };
    /**
     * Take one side per path and close the merge with a commit - the whole of tier one, as ONE
     * operation.
     *
     * One call rather than "resolve, then commit" from the renderer, because the two halves must
     * not be interleavable: anything else that commits in between (the checkpoint timer) would
     * close the author's merge under a different message and a different kind.
     */
    [IPCEventType.vcsCompleteMerge]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; decisions: VcsMergeDecision[]; options?: VcsCommitOptions },
        response: VcsMergeCompletion;
    };
    [IPCEventType.vcsUnresolveConflicts]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; paths: string[] },
        response: VcsMergeResolveResult;
    };
    /** **Discards the working-tree bytes** for these paths and merges them again. */
    [IPCEventType.vcsRestartConflicts]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; paths: string[] },
        response: VcsMergeState;
    };
    /** **Writes the working tree** back to before the merge. Re-read every document. */
    [IPCEventType.vcsAbortMerge]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string },
        response: VcsMergeState;
    };
    /** Local read: the configured server, or null. Opens no socket. */
    [IPCEventType.vcsGetRemote]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string },
        response: { url: string | null };
    };
    /** Local write: `null` disconnects. Does not contact the server. */
    [IPCEventType.vcsSetRemote]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; url: string | null },
        response: { url: string | null };
    };
    /** **Goes to the network** - up to ~2s when nothing answers. On demand only. */
    [IPCEventType.vcsGetSyncState]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string },
        response: VcsSyncState;
    };
    /** Local read: who this installation is signed in to this project's server as. */
    [IPCEventType.vcsGetServerSession]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string },
        response: { session: VcsServerSession | null };
    };
    /**
     * **Goes to the network**, twice: the sign-in endpoint and then the server itself.
     *
     * The token travels one way only. It is handed to the backend's own store and is never
     * written to Studio's state, logged, or returned in the response.
     */
    [IPCEventType.vcsSignIn]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; authUrl: string; token: string },
        response: VcsSignInOutcome;
    };
    /**
     * **Changes a setting of the operating system**, and is the only event here that does.
     *
     * Puts a server's certificate authority into this account's trust store, having been
     * asked to by somebody who was shown its fingerprint. Only a certificate this process
     * wrote is eligible - the path is checked against Studio's own directory, because a
     * renderer names it and a renderer is where untrusted content ends up.
     */
    [IPCEventType.vcsTrustAuthority]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; certificatePath: string },
        response: { installed: boolean; output: string };
    };
    /** Local: clears the stored token as well as Studio's record of whose it was. */
    [IPCEventType.vcsSignOut]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string },
        response: { session: null };
    };
    /**
     * Ask an `nlteam://` address what is behind it.
     *
     * **Goes to the network**, and is the first thing a wizard does. Takes no project and
     * writes nothing: an answer here is what the author is then shown and asked about.
     */
    [IPCEventType.vcsProbeServer]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { address: string },
        response: VcsServerProbe;
    };
    /**
     * Every server this installation is signed in to.
     *
     * Takes no project: a session belongs to the machine rather than to a repository, and
     * Settings asks this with no project open at all.
     */
    [IPCEventType.vcsListServers]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: Record<string, never>,
        response: { servers: VcsServerSession[] };
    };
    /**
     * Sign in to a server named by the token rather than by a project.
     *
     * The token carries the address of the endpoint that issued it and of the server it is
     * good for, so pasting one is the whole of adding a server. `authUrl` and `remoteUrl`
     * are the corrections for a token that names neither, and are empty otherwise.
     */
    [IPCEventType.vcsAddServer]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { authUrl: string; remoteUrl: string; token: string },
        response: VcsAddServerOutcome;
    };
    /**
     * Take a server off this machine: the stored token and Studio's record of it.
     *
     * Projects pointed at that server keep their address. What they lose is the account,
     * which is what signing out means.
     */
    [IPCEventType.vcsForgetServer]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { remoteOrigin: string },
        response: { servers: VcsServerSession[] };
    };
    [IPCEventType.vcsPush]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string },
        response: VcsPushResult;
    };
    /** **Writes the working tree.** The caller must re-read every document afterwards. */
    [IPCEventType.vcsSync]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string },
        response: VcsSyncResult;
    };
    /** No project session: there is no repository at `destination` until this finishes. */
    [IPCEventType.vcsClone]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { url: string; destination: string },
        response: { root: string; branch: string; fileCount: number };
    };
};

export type IPCFsEvents = {
    [IPCEventType.fsStat]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<FileStat>;
    };
    [IPCEventType.fsList]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<FileEntry[]>;
    };
    [IPCEventType.fsDetails]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<FileDetails>;
    };
    [IPCEventType.fsDirectorySize]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<DirectorySizeResult>;
    };
    [IPCEventType.fsRequestRead]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
            raw: boolean;
            encoding?: FsTextEncoding;
        },
        response: FsRequestResult<string>; // a hash that can be used to fetch the file later
    };
    /**
     * Grant read access to a whole directory tree, served as `app://fs/{hash}/{relative/path}`.
     *
     * Studio-internal (not on the plugin privileged surface, same as `fsDirectorySize`): a directory
     * grant is a broader capability than the single-file grants plugins get, and its one consumer is
     * the model-bundle asset resolver, whose served URL has to be something the bundle's own
     * relative sibling references resolve against.
     */
    [IPCEventType.fsRequestReadDir]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<string>; // a hash the whole tree can be fetched under
    };
    [IPCEventType.fsRequestWrite]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
            raw: boolean;
            encoding?: FsTextEncoding;
        },
        response: FsRequestResult<string>;
    };
    [IPCEventType.fsEnsureRegularFile]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
            data: string;
            encoding?: BufferEncoding;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsWriteFileNoFollow]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
            data: string;
            encoding?: BufferEncoding;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsRecoverCorruptedJsonFile]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
            replacement: string;
            encoding?: BufferEncoding;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsCreateDir]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsDeleteFile]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsDeleteDir]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsRename]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            oldPath: string;
            newName: string;
            isDir: boolean;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsCopyFile]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            src: string;
            dest: string;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsCopyDir]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            src: string;
            dest: string;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsMoveFile]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            src: string;
            dest: string;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsMoveDir]: { 
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            src: string;
            dest: string;
        },
        response: FsRequestResult<void>;
    };
    [IPCEventType.fsFileExists]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<boolean>;
    };
    [IPCEventType.fsDirExists]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<boolean>;
    };
    [IPCEventType.fsIsFile]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<boolean>;
    };
    [IPCEventType.fsIsDir]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<boolean>;
    };
    [IPCEventType.fsSelectFile]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            filters: string[];
            multiple: boolean;
        },
        response: FsRequestResult<string[]>;
    };
    [IPCEventType.fsSelectDirectory]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            multiple: boolean;
        },
        response: FsRequestResult<string[]>;
    };
    [IPCEventType.fsGrantFileAccess]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            paths: string[];
        },
        response: FsRequestResult<string[]>;
    };
    [IPCEventType.fsHash]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<string>;
    };
};

export type IPCEditorEvents = {
    [IPCEventType.editorLaunch]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            props: WindowProps[WindowAppType.Workspace];
            closeCurrentWindow: boolean;
        },
        response: void;
    };
};

export type IPCProjectWizardEvents = {
    [IPCEventType.projectWizardLaunch]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            created: boolean;
            projectPath: string;
        } | null;
    };
    [IPCEventType.projectWizardSelectDirectory]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            dest: string | null;
        };
    };
    /**
     * Choose the `.nlspkg` an import unpacks, granting this window read access to it.
     *
     * Separate from the import itself, so the wizard can show what was chosen and let the author
     * change their mind before anything is unpacked. That grant is also the only way the path the
     * renderer hands back is usable: the import handler checks rather than grants.
     */
    [IPCEventType.projectWizardSelectPackage]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            dest: string | null;
        };
    };
    [IPCEventType.projectWizardGetDefaultDirectory]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            dir: string;
        };
    };
};

export type IPCWorkspaceEvents = {
    [IPCEventType.workspaceLaunch]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            props: WindowProps[WindowAppType.Workspace];
            closeCurrentWindow?: boolean;
        },
        response: void;
    };
    [IPCEventType.workspaceOpenRecent]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
            /** Close the calling window once the target is open - a "switch in this window". */
            replaceCurrentWindow?: boolean;
        };
        response: void;
    };
    [IPCEventType.psdOpen]: {
        type: IPCMessageType.request;
        consumer: IPCType.Host;
        data: {};
        response: {
            filePath: string | null;
            document: PsdDocument | null;
        };
    };
    [IPCEventType.psdBake]: {
        type: IPCMessageType.request;
        consumer: IPCType.Host;
        data: {
            request: PsdBakeRequest;
        };
        response: {
            layers: PsdBakedLayer[];
        };
    };
    /**
     * What is inside a media file, and whether the engine can play it. Read-only: it runs ffprobe
     * and nothing else, converts nothing, and writes nothing.
     */
    [IPCEventType.mediaProbe]: {
        type: IPCMessageType.request;
        consumer: IPCType.Host;
        data: {
            path: string;
        };
        response: {
            outcome: MediaProbeOutcome;
        };
    };
    /**
     * Convert one media file, in the shape `gameBuild` uses for a long task: `start` returns a job
     * id straight away, `getStatus` is polled while it runs, `cancel` stops it.
     *
     * Split into three calls rather than one long-running request because a request that does not
     * answer for four minutes cannot report progress and cannot be called off, and because the work
     * has to outlive a renderer that reloads.
     */
    [IPCEventType.mediaConvertStart]: {
        type: IPCMessageType.request;
        consumer: IPCType.Host;
        data: {
            request: MediaConvertRequest;
        };
        response: {
            state: MediaConvertStateSnapshot;
        };
    };
    [IPCEventType.mediaConvertCancel]: {
        type: IPCMessageType.request;
        consumer: IPCType.Host;
        data: {
            jobId: string;
        };
        response: {
            state: MediaConvertStateSnapshot;
        };
    };
    [IPCEventType.mediaConvertGetStatus]: {
        type: IPCMessageType.request;
        consumer: IPCType.Host;
        data: {
            jobId: string;
        };
        response: {
            state: MediaConvertStateSnapshot;
        };
    };
    [IPCEventType.workspaceSelectFolder]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            path: string | null;
        };
    };
    [IPCEventType.workspaceClose]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: void;
    };
    [IPCEventType.workspaceExportProjectPackage]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
        },
        response: {
            canceled: boolean;
            packagePath?: string;
            fileCount?: number;
            byteLength?: number;
            skippedCount?: number;
        };
    };
    /**
     * Unpack a chosen package into a chosen folder.
     *
     * Both paths are the caller's, and neither is granted here: the two pickers
     * (`projectWizardSelectPackage`, `projectWizardSelectDirectory`) are what give this window
     * access to them, and this handler only checks. A path the renderer was never given stays
     * unreadable, which is the whole point of asking for them separately.
     */
    [IPCEventType.workspaceImportProjectPackage]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            packagePath: string;
            targetDir: string;
        },
        response: {
            projectPath: string;
            projectName?: string;
            fileCount?: number;
            byteLength?: number;
        };
    };
    [IPCEventType.workspaceExportConsoleLogs]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            defaultFileName: string;
            content: string;
        },
        response: {
            canceled: boolean;
            filePath?: string;
            byteLength?: number;
        };
    };
    /**
     * Reopen this window as a recovery shell, or as an ordinary workspace again.
     *
     * A reload rather than a state change, and that is the feature rather than an implementation
     * detail: recovery mode is entered because what the renderer holds cannot be trusted, so the
     * renderer is what gets discarded. Resolves after the reload has been asked for, not after the
     * new one has booted - the caller is about to stop existing.
     *
     * `reason` is carried into the new window's props so the recovery panel can lead with whatever
     * sent the author here (usually the workspace init error, which the reload would otherwise
     * destroy).
     */
    [IPCEventType.workspaceSetRecoveryMode]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            enabled: boolean;
            reason?: string;
        },
        response: void;
    };
    /**
     * Show this window's project folder in the OS file manager.
     *
     * Only ever the window's own project - the path is not a parameter - because "open a folder for
     * me" taking a renderer-supplied path is a way out of the sandbox, and every caller wants this
     * one folder anyway.
     */
    [IPCEventType.workspaceOpenProjectFolder]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: void;
    };
    /**
     * Asks the workspace to confirm closing, using its own in-app dialog rather than a native
     * message box. Driven from the main process, which owns the window's close guard.
     */
    [IPCEventType.workspaceConfirmClose]: {
        type: IPCMessageType.request,
        consumer: IPCType.Client,
        data: {};
        response: RequestStatus<{ confirmed: boolean }>;
    };
    /**
     * Tells the workspace which stage of its own close is running, so it can say so on screen.
     *
     * A message rather than a request: main must not wait on the renderer to acknowledge a
     * progress note - the whole point of the note is that main is busy with something else - and a
     * workspace that never renders it still closes exactly as before.
     *
     * `stage: null` means the close was called off (the launcher failed to start, so the window
     * stays open) and the indicator should go away. The ordinary ending needs no message: the
     * window is destroyed, and the indicator with it.
     */
    [IPCEventType.workspaceCloseProgress]: {
        type: IPCMessageType.message,
        consumer: IPCType.Client,
        data: {
            stage: WorkspaceCloseStage | null;
        };
        response: never;
    };
    /**
     * Tells the workspace to write out every auto-save it still owes, and waits for it.
     *
     * The main process blocks the window close / the app quit on this reply, which is the whole
     * point: the renderer's debounced writes go out over IPC, and once the window is torn down there
     * is nothing left to carry them. `flushed: false` means the workspace could not persist
     * everything (it says which stores in its own console channel); main proceeds either way rather
     * than trapping the user in a window that will not close.
     */
    [IPCEventType.workspaceFlushPendingSaves]: {
        type: IPCMessageType.request,
        consumer: IPCType.Client,
        data: {};
        response: RequestStatus<{ flushed: boolean }>;
    };
    [IPCEventType.workspaceResolveAssetUrl]: {
        type: IPCMessageType.request,
        consumer: IPCType.Client,
        data: {
            assetId: string;
            assetType?: string;
        };
        response: RequestStatus<{ url: string }>;
    };
    [IPCEventType.workspaceResolveImageAssetUrl]: {
        type: IPCMessageType.request,
        consumer: IPCType.Client,
        data: {
            assetId: string;
        };
        response: RequestStatus<{ url: string }>;
    };
    /**
     * The workspace telling main whether its project data is frozen right now.
     *
     * Main refuses the production build and the Preview runtime while it is - both are started in
     * main and reached by IPC, so a disabled button in the top bar does not stop them. Dev Mode is
     * allowed and runs the revision instead, which is why `revision`
     * travels with the kind.
     *
     * A message rather than a request: the renderer has nothing to do with the answer, and the
     * freeze changes on a human's timescale.
     */
    [IPCEventType.workspaceReportWriteFreeze]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: {
            /** Null when this project's data may be written again. */
            reason: WorkspaceFreezeKind | null;
            /**
             * Which revision the workspace is showing, when `reason` is `"revision"`.
             *
             * Optional in the type and load-bearing in practice: Dev Mode compiles the revision the
             * author is looking at, so main needs the id and not only the fact of a freeze. A
             * `"revision"` freeze that arrives without one makes main REFUSE the launch rather than
             * fall back to the working tree - running the current game while the author is reading
             * version #1 is the failure this exists to prevent.
             */
            revision?: RevisionId;
        };
        response: never;
    };
    [IPCEventType.workspaceBlueprintNavigateFromPreview]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: PreviewStudioBlueprintOpenPayload;
        response: never;
    };
    [IPCEventType.workspaceBlueprintDebugEvent]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: BlueprintDebugEvent;
        response: never;
    };
    [IPCEventType.workspaceDevModeConsoleLog]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: DevModeConsoleLogPayload;
        response: never;
    };
    [IPCEventType.workspaceStoryRowHighlight]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: DevModeStoryRowHighlight;
        response: never;
    };
    [IPCEventType.workspaceStoryRowOpen]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: DevModeStoryRowOpenRequest;
        response: never;
    };
};

export type IPCDevModeEvents = {
    [IPCEventType.devModeLaunch]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
            entry: DevModeEntry;
        },
        response: {
            status: DevModeStatus;
        };
    };
    /**
     * Dev Mode is per-project, so stop/reload/getStatus all name the project they mean - without
     * it a workspace would drive (and report) whichever session happened to exist, which with two
     * projects open is somebody else's.
     */
    [IPCEventType.devModeStop]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
        },
        response: {
            status: DevModeStatus;
        };
    };
    [IPCEventType.devModeReload]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
        },
        response: {
            status: DevModeStatus;
        };
    };
    [IPCEventType.devModeGetStatus]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
        },
        response: {
            status: DevModeStatus;
        };
    };
    /** Payload includes optional blueprint forward-compat fields on `DevModeBundle.ui` (M1+). */
    [IPCEventType.devModePayloadUpdate]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: {
            bundle: DevModeBundle;
        },
        response: never;
    };
    [IPCEventType.devModeFullscreenGet]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            isFullscreen: boolean;
        };
    };
    [IPCEventType.devModeFullscreenSet]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            fullscreen: boolean;
        },
        response: void;
    };
    [IPCEventType.devModeFullscreenChanged]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: {
            isFullscreen: boolean;
        },
        response: never;
    };
    /**
     * Asks the Dev Mode renderer whether the window may close, giving its blueprints a chance to
     * intercept the close (On Window Close Requested). Driven from the main process, which owns the
     * window's close guard; `allow: false` cancels the close.
     */
    [IPCEventType.devModeWindowCloseRequested]: {
        type: IPCMessageType.request,
        consumer: IPCType.Client,
        data: {};
        response: RequestStatus<{ allow: boolean }>;
    };
    [IPCEventType.devModeControlReload]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: {
            revision: number;
        },
        response: never;
    };
    [IPCEventType.devModeControlError]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: {
            message: string;
        },
        response: never;
    };
    [IPCEventType.devModeResolveAssetUrl]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            assetId: string;
            assetType?: string;
        };
        response: {
            url: string;
        };
    };
    [IPCEventType.devModeResolveImageAssetUrl]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            assetId: string;
        };
        response: {
            url: string;
        };
    };
    [IPCEventType.devModeOpenBlueprintInWorkspace]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: PreviewStudioBlueprintOpenPayload & {
            projectPath: string;
        };
        response: void;
    };
    [IPCEventType.devModeForwardBlueprintDebugEvent]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: DevModeBlueprintDebugEventPayload;
        response: never;
    };
    [IPCEventType.devModeForwardStoryRow]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: DevModeStoryRowPayload;
        response: never;
    };
    [IPCEventType.devModeOpenStoryRowInWorkspace]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: DevModeStoryRowOpenPayload;
        response: void;
    };
    [IPCEventType.devModeSaveWrite]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectRef: DevModeSaveProjectRef;
            id: string;
            savedGame: unknown;
            capture?: string;
            metadata?: unknown;
        };
        response: void;
    };
    [IPCEventType.devModeSaveRead]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectRef: DevModeSaveProjectRef;
            id: string;
        };
        response: {
            record: DevModeSaveRecord | null;
        };
    };
    [IPCEventType.devModeSaveListIds]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectRef: DevModeSaveProjectRef;
        };
        response: {
            ids: string[];
        };
    };
    [IPCEventType.devModeSaveReadPreview]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectRef: DevModeSaveProjectRef;
            id: string;
        };
        response: {
            capture: string | null;
        };
    };
    [IPCEventType.devModeSaveDelete]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectRef: DevModeSaveProjectRef;
            id: string;
        };
        response: {
            deleted: boolean;
        };
    };
};

export type IPCPreviewEvents = {
    [IPCEventType.previewLaunch]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
            entry: GameRuntimeLaunchEntry;
        };
        response: {
            status: PreviewStatus;
        };
    };
    [IPCEventType.previewStop]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
        };
        response: {
            status: PreviewStatus;
        };
    };
    [IPCEventType.previewGetStatus]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
        };
        response: {
            status: PreviewStatus;
        };
    };
};

/**
 * Game processes owned by a *test* run, not by the author's Run button.
 *
 * Separate from `IPCPreviewEvents` on purpose. Preview answers one question - "is it running" - by
 * polling, which is enough for an author watching their own game; a test has to tell a window being
 * closed from a process dying, and has to see an uncaught error rather than read about one in a log
 * line. Folding that onto the preview calls would have made every preview consumer carry it.
 */
export type IPCGameTestEvents = {
    [IPCEventType.gameTestLaunch]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: GameTestLaunchRequest;
        response: GameTestLaunchResult;
    };
    [IPCEventType.gameTestStop]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
            sessionId: string;
        };
        response: Record<string, never>;
    };
    [IPCEventType.workspaceGameTestEvent]: {
        type: IPCMessageType.message,
        consumer: IPCType.Client,
        data: GameTestEventPayload;
        // Required by `IPCConfiguration` even for a one-way push. Omitting it does not just weaken
        // this entry: `IPCEvents` stops satisfying the constraint every IPC generic is written
        // against, so every handler in main and every preload call fails to typecheck at once.
        response: never;
    };
};

export type IPCGameBuildEvents = {
    [IPCEventType.gameBuildStart]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
            entry: GameRuntimeLaunchEntry;
            request: GameBuildRequest;
        };
        response: {
            state: GameBuildStateSnapshot;
        };
    };
    [IPCEventType.gameBuildCancel]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
        };
        response: {
            state: GameBuildStateSnapshot;
        };
    };
    [IPCEventType.gameBuildGetStatus]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
        };
        response: {
            state: GameBuildStateSnapshot;
        };
    };
    [IPCEventType.gameBuildSelectOutputDir]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            defaultPath?: string;
        };
        response: {
            path: string | null;
        };
    };
    [IPCEventType.gameBuildPreflight]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
            request: GameBuildRequest;
        };
        response: {
            findings: BuildPreflightFinding[];
        };
    };
};

/**
 * The machine's code-signing credential vault.
 *
 * Passwords travel one way only. `import` carries the plain secrets the author
 * just typed up to the main process, which seals them immediately; no response
 * here ever carries a secret back, and there is deliberately no "read the
 * password" event. Unsealing happens in the main process alone, when a build
 * actually needs the material.
 */
export type IPCSigningEvents = {
    [IPCEventType.signingList]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: Record<string, never>,
        response: {
            /** Redacted: metadata only, never a password. */
            credentials: SigningCredential[];
        };
    };
    /**
     * Import a credential: the material files are copied into the vault and the
     * secrets in the payload are sealed. The payload holds plain passwords - do
     * not log it, do not keep it, do not send it anywhere else.
     */
    [IPCEventType.signingImport]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            input: SigningCredentialImport;
        },
        response: {
            credential: SigningCredential;
        };
    };
    [IPCEventType.signingRemove]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            id: string;
        },
        response: {
            /** False when the id was already gone. */
            removed: boolean;
        };
    };
    /**
     * Read the credential's certificate for display: subject, issuer, validity,
     * thumbprint. Never key material.
     */
    [IPCEventType.signingInspect]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            id: string;
        },
        response: SigningInspectResult;
    };
    /**
     * The signing keys inside a keystore the author has picked but not imported
     * yet, so the import form can offer them instead of asking for an alias
     * typed from memory. Same one-way traffic as `import`: the password goes up
     * and only the names come back.
     */
    [IPCEventType.signingKeystoreAliases]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            /** Absolute path the author picked; nothing is copied or kept. */
            file: string;
            /** Plain text - do not log it or keep it after the call. */
            storePassword: string;
        },
        response: {
            aliases: string[];
        };
    };
    /**
     * The code-signing identities in this Mac's keychains, so the import form can
     * offer them rather than asking for a certificate name typed from memory.
     * Empty on every other host, and on a Mac that holds none.
     */
    [IPCEventType.signingMacIdentities]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: Record<string, never>,
        response: {
            identities: MacSigningIdentity[];
        };
    };
};

/**
 * Plugin build-config secrets, sealed in the same machine vault the signing
 * passwords live in.
 *
 * Two events, and there is deliberately no third. The value goes up once, when
 * the author types it, and what comes back is a handle - the project file stores
 * that. Nothing here reads a secret back: unsealing happens in the main process
 * alone, when a build needs the value, and a "read it" event would be the whole
 * point of the vault undone.
 */
export type IPCPluginBuildSecretEvents = {
    /**
     * Seal a value and answer the handle to store. The payload is plaintext - do
     * not log it, do not keep it, do not send it anywhere else.
     */
    [IPCEventType.pluginBuildSecretSet]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            /** Plain text, one way only. */
            value: string;
            /**
             * The handle to fill in, when the project already refers to one and
             * the author is supplying the value on this machine. Omit to mint one.
             */
            handle?: string;
        },
        response: {
            /** What the project stores in place of the value. */
            handle: string;
            /** False when the OS keyring refused; the handle exists, the value was not stored. */
            available: boolean;
        };
    };
    /**
     * Whether the secret behind a handle is on this machine and can be unsealed.
     * False is the ordinary answer for a project a collaborator configured, and
     * means "set, not available here" rather than "empty".
     */
    [IPCEventType.pluginBuildSecretAvailable]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            handle: string;
        },
        response: {
            available: boolean;
        };
    };
};

export type IPCBlueprintPersistenceEvents = {
    [IPCEventType.blueprintPersistenceGetAll]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectRef: BlueprintPersistenceProjectRef;
        },
        response: {
            values: Record<string, unknown>;
        };
    };
    [IPCEventType.blueprintPersistenceGetValue]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectRef: BlueprintPersistenceProjectRef;
            key: string;
        },
        response: {
            value: unknown;
        };
    };
    [IPCEventType.blueprintPersistenceSetValue]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectRef: BlueprintPersistenceProjectRef;
            key: string;
            value: unknown;
        },
        response: void;
    };
    [IPCEventType.blueprintPersistenceRemoveValue]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectRef: BlueprintPersistenceProjectRef;
            key: string;
        },
        response: void;
    };
    /**
     * One Fetch node request, issued from the main process on the Dev Mode preview's behalf.
     *
     * The renderer sends the request and never the decision: the handler reads the project's own
     * Allow HTTP setting off disk and refuses when it is off. Trusting a flag the renderer passed
     * would make this channel a way around the setting rather than a way to honour it.
     *
     * The project path, not a window handle, is what identifies whose setting applies - the same
     * shape `devModeNetworkPolicy` already uses.
     */
    [IPCEventType.blueprintNetworkFetch]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
            request: BlueprintNetworkFetchRequest;
        },
        response: {
            result: BlueprintNetworkFetchResult;
        };
    };
    /**
     * One Open Link node request, decided and performed by the main process on the Dev Mode
     * preview's behalf.
     *
     * The renderer sends the address and never the permission: the handler reads the project's own
     * declared addresses off disk and refuses anything else, which is what makes Dev Mode behave
     * like the shipped game rather than like a window with Studio's privileges behind it.
     *
     * The project path, not a window handle, identifies whose declaration applies - the same shape
     * the Fetch channel above uses.
     */
    [IPCEventType.blueprintExternalLinkOpen]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
            request: BlueprintOpenExternalRequest;
        },
        response: {
            result: BlueprintOpenExternalResult;
        };
    };
    /**
     * One runtime plugin's request to open an address, decided by the main process against that
     * plugin's own declared patterns.
     *
     * A channel of its own rather than a flag on the one above, because the two consult different
     * declarations and neither must be able to reach the other's. This one never looks at the
     * project's variant list, and the Open Link node never looks at a plugin's manifest.
     *
     * `pluginId` selects whose declaration applies; the handler reads it from the installed
     * plugin's manifest rather than taking any patterns from the renderer, which is what keeps this
     * a way to honour the declaration instead of a way around it.
     */
    [IPCEventType.blueprintExternalLinkOpenForPlugin]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            pluginId: string;
            request: BlueprintOpenExternalRequest;
        },
        response: {
            result: BlueprintOpenExternalResult;
        };
    };
    /**
     * The Export Progress node's request, in a Dev Mode preview.
     *
     * Dev Mode has to behave like the packaged game, so the write is made where the packaged game
     * makes it - in the process that owns the filesystem - and the file it writes is the very same
     * one, named by the key the build would carry. The renderer sends what the playthrough holds
     * and never which file: the handler derives the key from the project's own identity, exactly as
     * the pack compiler does, so a preview cannot be talked into writing another title's document.
     *
     * The project path, not a window handle, identifies whose progress this is - the same shape the
     * external-link channels above use.
     */
    [IPCEventType.blueprintProgressWrite]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
            request: GameProgressExportRequest;
        },
        response: {
            result: GameProgressExportResult;
        };
    };
    /** The Import Progress node's request, read by the same process and keyed the same way. */
    [IPCEventType.blueprintProgressRead]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            projectPath: string;
        },
        response: {
            result: GameProgressImportResult;
        };
    };
};

/**
 * The one question a server's certificate raises, asked in a window of its own.
 *
 * No project path: an authority is trusted for the account, not for a project, and the
 * window is raised from Settings as readily as from a workspace. The response says what
 * the machine now believes rather than which button was pressed - the install can be
 * refused by the operating system after the author has agreed.
 */
export type IPCServerTrustEvents = {
    [IPCEventType.serverTrustPrompt]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            props: WindowProps[WindowAppType.ServerTrustPrompt];
        },
        response: { trusted: boolean };
    };
};

export type IPCPluginPermissionEvents = {
    [IPCEventType.pluginPermissionPromptLaunch]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            props: WindowProps[WindowAppType.PluginPermissionPrompt];
        },
        response: PluginPermissionPromptResult;
    };
    [IPCEventType.pluginPermissionGrant]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: PluginPermissionGrantPayload,
        response: PluginPermissionGrantResult;
    };
};

export type IPCPluginManagerEvents = {
    [IPCEventType.pluginList]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            plugins: PluginListItem[];
        };
    };
    [IPCEventType.pluginInstallLocal]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: PluginInstallResult;
    };
    [IPCEventType.pluginSetEnabled]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            pluginId: string;
            enabled: boolean;
        },
        response: PluginListItem;
    };
    [IPCEventType.pluginApprove]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            pluginId: string;
        },
        response: PluginApproveResult;
    };
    [IPCEventType.pluginUninstall]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            pluginId: string;
        },
        response: void;
    };
    [IPCEventType.pluginRevoke]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            pluginId: string;
        },
        response: PluginListItem;
    };
    [IPCEventType.pluginWorkspaceList]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            plugins: WorkspacePluginDescriptor[];
        };
    };
    [IPCEventType.pluginRuntimeList]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            plugins: RuntimePluginDescriptor[];
        };
    };
    [IPCEventType.pluginReportLoadError]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            pluginId: string;
            error: string | null;
        },
        response: PluginListItem;
    };
    // Aggregated Studio language-pack contributions from every enabled plugin.
    // Any window may request these to populate the locale registry + picker.
    [IPCEventType.pluginLocaleList]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            contributions: LocaleContribution[];
        };
    };
    // Host -> renderer push: fired for every window when the enabled plugin set
    // changes, so each window re-fetches locale contributions and re-localizes.
    [IPCEventType.pluginLocalesChanged]: {
        type: IPCMessageType.message,
        consumer: IPCType.Client,
        data: {
            version: number;
        },
        response: never;
    };
    // Store: fetch the registry index (configured URL, else the official default).
    [IPCEventType.pluginRegistryFetch]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: PluginRegistryFetchResult;
    };
    /**
     * Store: the plugin's thumbnail, as a `data:` URL, or null when it has none.
     *
     * The renderer sends an id, never a URL, and never fetches the image itself:
     * renderers do not talk to the network, so main resolves the address from
     * the index it trusts, checks the bytes, and caches them by version.
     */
    [IPCEventType.pluginRegistryIcon]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            pluginId: string;
        },
        response: { icon: string | null };
    };
    // Store: download + extract + install a registry plugin by id. The download
    // URL is taken from the freshly fetched index, never from the renderer. Lands
    // in `needsAuthorization`, exactly like a local-folder install.
    [IPCEventType.pluginInstallFromRegistry]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            pluginId: string;
        },
        response: PluginInstallResult;
    };
    /**
     * Build a named puppet runtime out of an SDK archive the author supplied, into their project.
     *
     * In the host because it needs a bundler; see `managers/puppet/live2dRuntimeBuild.ts` for why the
     * adapter cannot simply be shipped. The renderer names the *runtime*, never the destination — the
     * host derives that from the project path, which it authorizes against the window's own file-system
     * grant, so a renderer cannot aim a megabyte of generated code anywhere it likes.
     */
    [IPCEventType.puppetRuntimeInstallSdk]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            /** A `KnownPuppetRuntimeId`; validated against the registry rather than trusted. */
            runtimeId: string;
            projectPath: string;
            /** The archive the author picked in a file dialog. Read, never written. */
            archivePath: string;
        },
        response: PuppetRuntimeInstallResult;
    };
};

export type IPCUITemplateEvents = {
    // Store: fetch the UI template registry index (configured URL, else the default).
    [IPCEventType.uiTemplateRegistryFetch]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: UITemplateFetchResult;
    };
    // Store: fetch one template's document pair + declared resources from the raw
    // blob directory the index came from. The paths come from the freshly fetched
    // index, never from the renderer. The renderer migrates and applies the result.
    [IPCEventType.uiTemplateFetchBundle]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            templateId: string;
        },
        response: UITemplateBundle;
    };
    // Store: fetch just the `UIDocument` of several templates, to draw their cards.
    // One call for the whole grid, so the index is fetched once rather than per card.
    [IPCEventType.uiTemplateFetchPreviews]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            templateIds: string[];
        },
        response: UITemplatePreview[];
    };
    // Store: fetch the poster image of each named theme, for the browse level.
    [IPCEventType.uiTemplateFetchThemePreviews]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            themeIds: string[];
        },
        response: UIThemePreview[];
    };

    // Bundled project templates: what this build ships, read from resources/.
    [IPCEventType.projectTemplateList]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: ProjectTemplateDescriptor[];
    };
    // Copy one bundled template's content over a project the wizard just wrote.
    [IPCEventType.projectTemplateScaffold]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            templateId: string;
            projectPath: string;
        },
        response: { filesCopied: number };
    };
};

export type IPCAssetEvents = {
    /**
     * Fetch the bytes behind a remote asset's URL, in main.
     *
     * The renderer supplies the address here, unlike the store events above — it is the one the
     * author typed into the import dialog, not one read out of untrusted data. What the boundary
     * buys is that the *request* is main's: the scheme allowlist, the size ceiling, the timeout and
     * the author's download rewrites all apply, and the renderer receives bytes instead of putting
     * a remote URL into the DOM.
     *
     * `validators` makes the request conditional, so refreshing an unchanged asset transfers
     * nothing and answers `not-modified`.
     */
    [IPCEventType.assetFetchRemote]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            url: string;
            validators?: RemoteAssetValidators;
        },
        response: RemoteAssetFetchResult;
    };
    /**
     * Copy library files out to a folder the author picks.
     *
     * The dialog and the copying both happen here rather than in the renderer, because a folder
     * chosen through `fsSelectDirectory` is granted *read* access only - a renderer-side copy into
     * it would be refused by the very policy that makes the picker safe. The renderer says which
     * files and what to call them; main decides whether it is allowed to read each source (the
     * window's existing grants, i.e. the project) and where under the chosen folder it may land.
     */
    [IPCEventType.assetExportToFolder]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            entries: AssetExportEntry[];
        },
        response: AssetExportResult;
    };
};

export type IPCPrivilegedEvents = {
    [IPCEventType.privilegedFsCall]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: PrivilegedFileSystemCallPayload,
        response: PrivilegedFileSystemCallResult;
    };
    [IPCEventType.privilegedPermissionRequest]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: PrivilegedPermissionRequestPayload,
        response: PluginPermissionPromptResult;
    };
    [IPCEventType.privilegedPermissionRevokePlugin]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: PrivilegedPermissionRevokePluginPayload,
        response: void;
    };
    [IPCEventType.privilegedBashExecute]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: PrivilegedBashExecutePayload,
        response: PrivilegedBashExecuteResult;
    };
};

export type IPCMenuEvents = {
    [IPCEventType.menuAction]: {
        type: IPCMessageType.message,
        consumer: IPCType.Client,
        data: { action: MenuActionId },
        response: never;
    };
    /**
     * The renderer pushing its current, focus-filtered menu model up so the native menu bar can
     * mirror it. Sent on every registry/focus change; the main process rebuilds the menu when
     * the sending window is the focused one.
     */
    [IPCEventType.workspaceMenuSync]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: { model: NativeMenuModel },
        response: never;
    };
    [IPCEventType.workspaceReportLoadResult]: {
        type: IPCMessageType.message,
        consumer: IPCType.Host,
        data: { ok: boolean },
        response: never;
    };
    /**
     * Main asking one workspace window to reveal a surface, on behalf of the Settings window.
     * Addressed to a single window: broadcasting would pop the same tab open in every workspace.
     */
    [IPCEventType.workspaceOpenView]: {
        type: IPCMessageType.message,
        consumer: IPCType.Client,
        data: { view: WorkspaceViewRequest },
        response: never;
    };
    /**
     * Main telling the already-open Settings window which setting to reveal. Sent instead of
     * launching a second window when one is open, so "open settings at X" is idempotent.
     */
    [IPCEventType.settingsHighlight]: {
        type: IPCMessageType.message,
        consumer: IPCType.Client,
        data: { highlight: string },
        response: never;
    };
    /**
     * Main pushing the updater's state to every open window.
     *
     * Broadcast rather than addressed: the Settings panel draws the detail, the launcher shows a
     * line beside the version number, and a workspace raises a notification - three surfaces that
     * must not disagree about whether an update is downloading.
     */
    [IPCEventType.appUpdateStateChanged]: {
        type: IPCMessageType.message,
        consumer: IPCType.Client,
        data: { state: UpdateState },
        response: never;
    };
};

