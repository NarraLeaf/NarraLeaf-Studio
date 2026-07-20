import { FileDetails, FileStat } from "@shared/utils/fs";
import { AppInfo } from "./app";
import { IPCMessageType, IPCType } from "./ipc";
import { FsRequestResult, PlatformInfo } from "./os";
import { WindowAppType, WindowProps, WindowVisibilityStatus, WindowControlAbility, WindowCloseResults, WorkspaceViewRequest } from "./window";
import { GlobalStateKeys, GlobalStateValue } from "./state/globalState";
import type { MissingRecentProject } from "./state/appStateTypes";
import { DevModeBlueprintDebugEventPayload, DevModeBundle, DevModeConsoleLogPayload, DevModeEntry, DevModeStatus } from "./devMode";
import type { GameRuntimeLaunchEntry, PreviewStatus } from "./gameRuntime";
import type { BuildPreflightFinding, GameBuildRequest, GameBuildStateSnapshot } from "./gameBuild";
import type { BlueprintDebugEvent } from "./blueprint/debug";
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
import type {
    RevisionId,
    VcsAvailability,
    VcsBlobRequest,
    VcsHistoryEntry,
    VcsRepositoryInfo,
    VcsThreeWayResult,
} from "./vcs";

export enum IPCEventType {
    getPlatform = "getPlatform",
    appTerminate = "app.terminate",
    appWindowControl = "app.window.setControl",
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
    appPickBackgroundImage = "app.pickBackgroundImage",
    appReadBackgroundImage = "app.readBackgroundImage",
    appGlobalStateGet = "app.globalState.get",
    appGlobalStateSet = "app.globalState.set",
    appGlobalStateGetAll = "app.globalState.getAll",
    appGlobalStateChanged = "app.globalState.changed",
    appAddRecentProject = "app.addRecentProject",
    appRemoveRecentProject = "app.removeRecentProject",
    appCheckRecentProjects = "app.checkRecentProjects",
    appSystemPath = "app.systemPath",

    fsStat = "fs.stat",
    fsList = "fs.list",
    fsDetails = "fs.details",
    fsRequestRead = "fs.requestRead",
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
    projectWizardGetDefaultDirectory = "projectWizard.getDefaultDirectory",
    
    workspaceLaunch = "workspace.launch",
    workspaceOpenRecent = "workspace.openRecent",
    workspaceSelectFolder = "workspace.selectFolder",
    workspaceClose = "workspace.close",
    workspaceExportProjectPackage = "workspace.projectPackage.export",
    workspaceImportProjectPackage = "workspace.projectPackage.import",
    workspaceExportConsoleLogs = "workspace.console.exportLogs",
    workspaceConfirmClose = "workspace.confirmClose",
    workspaceResolveAssetUrl = "workspace.resolveAssetUrl",
    workspaceResolveImageAssetUrl = "workspace.resolveImageAssetUrl",
    workspaceBlueprintNavigateFromPreview = "workspace.blueprint.navigateFromPreview",
    workspaceBlueprintDebugEvent = "workspace.blueprint.debugEvent",
    workspaceDevModeConsoleLog = "workspace.devMode.consoleLog",
    
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

    gameBuildStart = "gameBuild.start",
    gameBuildCancel = "gameBuild.cancel",
    gameBuildGetStatus = "gameBuild.getStatus",
    gameBuildSelectOutputDir = "gameBuild.selectOutputDir",
    gameBuildPreflight = "gameBuild.preflight",

    blueprintPersistenceGetAll = "blueprintPersistence.getAll",
    blueprintPersistenceGetValue = "blueprintPersistence.getValue",
    blueprintPersistenceSetValue = "blueprintPersistence.setValue",
    blueprintPersistenceRemoveValue = "blueprintPersistence.removeValue",

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
    vcsGetHistory = "vcs.getHistory",
    vcsReadBlob = "vcs.readBlob",
    vcsGetChangedPaths = "vcs.getChangedPaths",
    vcsGetThreeWay = "vcs.getThreeWay",
    vcsGetMergeBase = "vcs.getMergeBase",
}

export type VoidRequestStatus = RequestStatus<void>;
export type RequestStatus<T> = {
    success: true;
    data: T;
    error?: never;
} | {
    success: false;
    data?: never;
    error?: string;
};

export type BlueprintPersistenceProjectRef = {
    projectIdentifier?: string;
    projectPath: string;
};

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
} & IPCMenuEvents & IPCFsEvents & IPCEditorEvents & IPCProjectWizardEvents & IPCWorkspaceEvents & IPCDevModeEvents & IPCPreviewEvents & IPCGameBuildEvents & IPCBlueprintPersistenceEvents & IPCPluginPermissionEvents & IPCPluginManagerEvents & IPCPrivilegedEvents & IPCVcsEvents;

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
    [IPCEventType.vcsGetHistory]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; limit?: number },
        response: { entries: VcsHistoryEntry[] };
    };
    [IPCEventType.vcsReadBlob]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: VcsBlobRequest,
        response: { contentBase64: string };
    };
    [IPCEventType.vcsGetChangedPaths]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: { projectPath: string; from: RevisionId; to: RevisionId },
        response: { paths: string[] };
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
        response: FsRequestResult<FileStat[]>;
    };
    [IPCEventType.fsDetails]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
        },
        response: FsRequestResult<FileDetails>;
    };
    [IPCEventType.fsRequestRead]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
            raw: boolean;
            encoding?: BufferEncoding;
        },
        response: FsRequestResult<string>; // a hash that can be used to fetch the file later
    };
    [IPCEventType.fsRequestWrite]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            path: string;
            raw: boolean;
            encoding?: BufferEncoding;
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
    [IPCEventType.workspaceImportProjectPackage]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            canceled: boolean;
            projectPath?: string;
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
     * Asks the workspace to confirm closing, using its own in-app dialog rather than a native
     * message box. Driven from the main process, which owns the window's close guard.
     */
    [IPCEventType.workspaceConfirmClose]: {
        type: IPCMessageType.request,
        consumer: IPCType.Client,
        data: {};
        response: RequestStatus<{ confirmed: boolean }>;
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
};
