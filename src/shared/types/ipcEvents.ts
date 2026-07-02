import { FileDetails, FileStat } from "@shared/utils/fs";
import { AppInfo } from "./app";
import { IPCMessageType, IPCType } from "./ipc";
import { FsRequestResult, PlatformInfo } from "./os";
import { WindowAppType, WindowProps, WindowVisibilityStatus, WindowControlAbility, WindowCloseResults } from "./window";
import { GlobalStateKeys, GlobalStateValue } from "./state/globalState";
import { DevModeBlueprintDebugEventPayload, DevModeBundle, DevModeConsoleLogPayload, DevModeEntry, DevModeStatus } from "./devMode";
import type { BlueprintDebugEvent } from "./blueprint/debug";
import type { DevModeSaveProjectRef, DevModeSaveRecord } from "./devModeSave";
import type { PreviewStudioBlueprintOpenPayload } from "./previewStudioBlueprintOpen";
import type { PluginPermissionGrantPayload, PluginPermissionGrantResult, PluginPermissionPromptResult } from "./pluginPermissions";
import type {
    PluginApproveResult,
    PluginInstallResult,
    PluginListItem,
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

export const WorkspaceMenuAction = {
    NewWorkspace: "narraleaf-studio:file-new",
    OpenWorkspace: "narraleaf-studio:file-open",
    ExportProject: "narraleaf-studio:file-export-project",
    CloseWorkspace: "narraleaf-studio:file-close-workspace",
    OpenWelcome: "narraleaf-studio:open-welcome",
} as const;

export type WorkspaceMenuAction = typeof WorkspaceMenuAction[keyof typeof WorkspaceMenuAction];

export enum IPCEventType {
    getPlatform = "getPlatform",
    appTerminate = "app.terminate",
    appWindowControl = "app.window.setControl",
    appWindowClose = "app.window.close",
    appWindowCloseWith = "app.window.closeWith",
    appWindowGetControl = "app.window.getControl",
    appWindowControlAbility = "app.window.getControlAbility",
    appWindowProps = "app.window.props",
    appInfo = "app.info",
    appWindowReady = "app.window.ready",
    appLaunchSettings = "app.settings.launchWindow",
    appGlobalStateGet = "app.globalState.get",
    appGlobalStateSet = "app.globalState.set",
    appGlobalStateGetAll = "app.globalState.getAll",
    appAddRecentProject = "app.addRecentProject",
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
    workspaceSelectFolder = "workspace.selectFolder",
    workspaceClose = "workspace.close",
    workspaceExportProjectPackage = "workspace.projectPackage.export",
    workspaceImportProjectPackage = "workspace.projectPackage.import",
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
    pluginReportLoadError = "plugin.reportLoadError",

    privilegedFsCall = "privileged.fs.call",
    privilegedPermissionRequest = "privileged.permission.request",
    privilegedPermissionRevokePlugin = "privileged.permission.revokePlugin",
    privilegedBashExecute = "privileged.bash.execute",

    menuAction = "app.menu.action",
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
    [IPCEventType.appAddRecentProject]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            name: string;
            path: string;
        },
        response: void;
    };
    [IPCEventType.appSystemPath]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {
            name: "desktop";
        },
        response: {
            path: string;
        };
    };
} & IPCMenuEvents & IPCFsEvents & IPCEditorEvents & IPCProjectWizardEvents & IPCWorkspaceEvents & IPCDevModeEvents & IPCBlueprintPersistenceEvents & IPCPluginPermissionEvents & IPCPluginManagerEvents & IPCPrivilegedEvents;

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
    [IPCEventType.devModeStop]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            status: DevModeStatus;
        };
    };
    [IPCEventType.devModeReload]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
        response: {
            status: DevModeStatus;
        };
    };
    [IPCEventType.devModeGetStatus]: {
        type: IPCMessageType.request,
        consumer: IPCType.Host,
        data: {},
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
        data: { action: WorkspaceMenuAction },
        response: never;
    };
};
