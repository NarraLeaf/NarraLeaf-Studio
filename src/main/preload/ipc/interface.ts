import { RendererInterfaceKey } from "@shared/types/constants";
import { Namespace } from "@shared/types/ipc";
import { IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { EditMenuRole, MenuActionId, NativeMenuModel } from "@shared/types/menu";
import type { FsTextEncoding } from "@shared/types/textEncoding";
import type { BlueprintPersistenceProjectRef, WorkspaceCloseStage, WorkspaceFreezeKind } from "@shared/types/ipcEvents";
import type { BlueprintNetworkFetchRequest, BlueprintNetworkFetchResult } from "@shared/types/blueprint/network";
import { GlobalStateKeys, GlobalStateValue } from "@shared/types/state/globalState";
import type { MissingRecentProject } from "@shared/types/state/appStateTypes";
import { WindowAppType, WindowControlAbility, WindowProps, WindowCloseResults, WorkspaceViewRequest } from "@shared/types/window";
import type { DevModeBlueprintDebugEventPayload, DevModeEntry, DevModeStatus, DevModeBundle, DevModeConsoleLogPayload, DevModeStoryRowHighlight, DevModeStoryRowOpenPayload, DevModeStoryRowOpenRequest, DevModeStoryRowPayload } from "@shared/types/devMode";
import type { GameRuntimeLaunchEntry, PreviewStatus } from "@shared/types/gameRuntime";
import type { GameTestEventPayload, GameTestLaunchRequest, GameTestLaunchResult } from "@shared/types/gameTest";
import type { BuildPreflightFinding, GameBuildRequest, GameBuildStateSnapshot } from "@shared/types/gameBuild";
import type { MediaConvertRequest, MediaConvertStateSnapshot } from "@shared/types/mediaConvert";
import type {
    MacSigningIdentity,
    SigningCredential,
    SigningCredentialImport,
    SigningInspectResult,
} from "@shared/types/signing";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { DevModeSaveProjectRef, DevModeSaveRecord } from "@shared/types/devModeSave";
import type { PreviewStudioBlueprintOpenPayload } from "@shared/types/previewStudioBlueprintOpen";
import type { PluginPermissionDecision, PluginPermissionRequest } from "@shared/types/pluginPermissions";
import type { PrivilegedActor } from "@shared/types/privileged";
import type { RemoteAssetValidators } from "@shared/types/remoteAsset";
import type { AssetExportEntry } from "@shared/types/assetExport";
import type { RevisionId, VcsAvailability, VcsCheckpointReason, VcsCommitOptions, VcsCommitResult, VcsConflictChoice, VcsHistoryEntry, VcsInitOptions, VcsMergeCompletion, VcsMergeDecision, VcsMergeDocument, VcsMergeResolveResult, VcsMergeState, VcsRepositoryInfo, VcsPushResult, VcsRestoreOptions, VcsRestoreResult, VcsRevisionDiffResult, VcsStatus, VcsSyncResult, VcsSyncState, VcsThreeWayResult, VcsWorkingTreeDiffResult } from "@shared/types/vcs";
import type { RendererPrivilegedBootstrapInterface, RendererPrivilegedInterface } from "@shared/types/renderer";
import { IPCClient } from "./ipcClient";
import { webUtils } from "electron";

export const ipcClient = new IPCClient(Namespace.NarraLeafStudio);

let privilegedBridgeHardened = false;

function deniedAfterHarden<T>(): Promise<RequestStatus<T>> {
    return Promise.resolve({
        success: false,
        error: "Privileged renderer IPC is no longer available from the global bridge",
    });
}

function createPrivilegedBridge(guarded: boolean): RendererPrivilegedInterface {
    const invoke = <T,>(event: IPCEventType, data: unknown): Promise<RequestStatus<T>> => {
        if (guarded && privilegedBridgeHardened) {
            return deniedAfterHarden<T>();
        }
        return ipcClient.invoke(event as never, data as never) as Promise<RequestStatus<T>>;
    };

    return {
        fs: {
            selectFile: (actor: PrivilegedActor, filters: string[], multiple: boolean, title?: string) =>
                invoke(IPCEventType.privilegedFsCall, {
                    actor,
                    operation: "selectFile",
                    filters,
                    multiple,
                    ...(title === undefined ? {} : { title }),
                }),
            selectSaveFile: (actor: PrivilegedActor, defaultFileName: string, filters: string[]) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "selectSaveFile", defaultFileName, filters }),
            stat: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "stat", path }),
            list: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "list", path }),
            details: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "details", path }),
            requestRead: (actor: PrivilegedActor, path: string, encoding: FsTextEncoding) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "requestRead", path, encoding, raw: false }),
            requestReadRaw: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "requestRead", path, raw: true }),
            requestWrite: (actor: PrivilegedActor, path: string, encoding: FsTextEncoding) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "requestWrite", path, encoding, raw: false }),
            requestWriteRaw: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "requestWrite", path, raw: true }),
            ensureRegularFile: (actor: PrivilegedActor, path: string, data: string, encoding: BufferEncoding = "utf-8") =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "ensureRegularFile", path, data, encoding }),
            writeFileNoFollow: (actor: PrivilegedActor, path: string, data: string, encoding: BufferEncoding = "utf-8") =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "writeFileNoFollow", path, data, encoding }),
            recoverCorruptedJsonFile: (actor: PrivilegedActor, path: string, replacement: string, encoding: BufferEncoding = "utf-8") =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "recoverCorruptedJsonFile", path, replacement, encoding }),
            createDir: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "createDir", path }),
            deleteFile: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "deleteFile", path }),
            deleteDir: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "deleteDir", path }),
            rename: (actor: PrivilegedActor, oldPath: string, newName: string, isDir: boolean) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "rename", oldPath, newName, isDir }),
            copyFile: (actor: PrivilegedActor, src: string, dest: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "copyFile", src, dest }),
            copyDir: (actor: PrivilegedActor, src: string, dest: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "copyDir", src, dest }),
            moveFile: (actor: PrivilegedActor, src: string, dest: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "moveFile", src, dest }),
            moveDir: (actor: PrivilegedActor, src: string, dest: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "moveDir", src, dest }),
            isFileExists: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "fileExists", path }),
            isDirExists: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "dirExists", path }),
            isFile: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "isFile", path }),
            isDir: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "isDir", path }),
            hash: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "hash", path }),
        },
        permissions: {
            request: (actor: PrivilegedActor, request: PluginPermissionRequest) =>
                invoke(IPCEventType.privilegedPermissionRequest, { actor, request }),
            revokePlugin: (actor: PrivilegedActor, pluginId: string) =>
                invoke(IPCEventType.privilegedPermissionRevokePlugin, { actor, pluginId }),
        },
        bash: {
            execute: (actor: PrivilegedActor, command: string, cwd?: string) =>
                invoke(IPCEventType.privilegedBashExecute, { actor, command, cwd }),
        },
    };
}

const privilegedRuntimeBridge = createPrivilegedBridge(false);
const privilegedBootstrapBridge: RendererPrivilegedBootstrapInterface = {
    ...createPrivilegedBridge(true),
    acquire: () => {
        if (privilegedBridgeHardened) {
            throw new Error("Privileged renderer IPC has already been hardened");
        }
        return privilegedRuntimeBridge;
    },
    harden: () => {
        privilegedBridgeHardened = true;
    },
    isHardened: () => privilegedBridgeHardened,
};

export const IPCInterface: Window[typeof RendererInterfaceKey] = {
    getPlatform: () => ipcClient.invoke(IPCEventType.getPlatform, {}),
    getAppInfo: () => ipcClient.invoke(IPCEventType.appInfo, {}),
    getWindowProps: <T extends WindowAppType>(): Promise<RequestStatus<WindowProps[T]>> => ipcClient.invoke(IPCEventType.appWindowProps, {}) as Promise<RequestStatus<WindowProps[T]>>,
    terminate: async (err?: string) => ipcClient.send(IPCEventType.appTerminate, { err: err ?? null }),
    window: {
        ready: () => ipcClient.send(IPCEventType.appWindowReady, {}),
        close: () => ipcClient.send(IPCEventType.appWindowClose, {}),
        closeWith: <T extends WindowAppType = WindowAppType>(result: WindowCloseResults[T]) => ipcClient.send(IPCEventType.appWindowCloseWith, { result }),
        editCommand: (command: EditMenuRole) => ipcClient.send(IPCEventType.appWindowEditCommand, { command }),
        control: {
            minimize: () => ipcClient.invoke(IPCEventType.appWindowControl, { control: "minimize" }),
            maximize: () => ipcClient.invoke(IPCEventType.appWindowControl, { control: "maximize" }),
            unmaximize: () => ipcClient.invoke(IPCEventType.appWindowControl, { control: "unmaximize" }),
            close: () => ipcClient.invoke(IPCEventType.appWindowControl, { control: "close" }),
            status: () => ipcClient.invoke(IPCEventType.appWindowGetControl, {}),
            ability: () => ipcClient.invoke(IPCEventType.appWindowControlAbility, {}) as Promise<RequestStatus<WindowControlAbility>>,
            getFullscreen: () => ipcClient.invoke(IPCEventType.appWindowGetFullscreen, {}),
            onFullscreenChanged: (handler: (payload: { isFullscreen: boolean }) => void) =>
                ipcClient.onMessage(IPCEventType.appWindowFullscreenChanged, handler),
        },
    },
    fs: {
        stat: (path: string) => ipcClient.invoke(IPCEventType.fsStat, { path }),
        list: (path: string) => ipcClient.invoke(IPCEventType.fsList, { path }),
        details: (path: string) => ipcClient.invoke(IPCEventType.fsDetails, { path }),
        directorySize: (path: string) => ipcClient.invoke(IPCEventType.fsDirectorySize, { path }),
        requestRead: (path: string, encoding: FsTextEncoding) => ipcClient.invoke(IPCEventType.fsRequestRead, { path, encoding, raw: false }),
        requestReadRaw: (path: string) => ipcClient.invoke(IPCEventType.fsRequestRead, { path, raw: true }),
        requestReadDir: (path: string) => ipcClient.invoke(IPCEventType.fsRequestReadDir, { path }),
        requestWrite: (path: string, encoding: FsTextEncoding) => ipcClient.invoke(IPCEventType.fsRequestWrite, { path, encoding, raw: false }),
        requestWriteRaw: (path: string) => ipcClient.invoke(IPCEventType.fsRequestWrite, { path, raw: true }),
        ensureRegularFile: (path: string, data: string, encoding: BufferEncoding = "utf-8") => ipcClient.invoke(IPCEventType.fsEnsureRegularFile, { path, data, encoding }),
        writeFileNoFollow: (path: string, data: string, encoding: BufferEncoding = "utf-8") => ipcClient.invoke(IPCEventType.fsWriteFileNoFollow, { path, data, encoding }),
        recoverCorruptedJsonFile: (path: string, replacement: string, encoding: BufferEncoding = "utf-8") => ipcClient.invoke(IPCEventType.fsRecoverCorruptedJsonFile, { path, replacement, encoding }),
        createDir: (path: string) => ipcClient.invoke(IPCEventType.fsCreateDir, { path }),
        deleteFile: (path: string) => ipcClient.invoke(IPCEventType.fsDeleteFile, { path }),
        deleteDir: (path: string) => ipcClient.invoke(IPCEventType.fsDeleteDir, { path }),
        rename: (oldPath: string, newName: string, isDir: boolean) => ipcClient.invoke(IPCEventType.fsRename, { oldPath, newName, isDir }),
        copyFile: (src: string, dest: string) => ipcClient.invoke(IPCEventType.fsCopyFile, { src, dest }),
        copyDir: (src: string, dest: string) => ipcClient.invoke(IPCEventType.fsCopyDir, { src, dest }),
        moveFile: (src: string, dest: string) => ipcClient.invoke(IPCEventType.fsMoveFile, { src, dest }),
        moveDir: (src: string, dest: string) => ipcClient.invoke(IPCEventType.fsMoveDir, { src, dest }),
        isFileExists: (path: string) => ipcClient.invoke(IPCEventType.fsFileExists, { path }),
        isDirExists: (path: string) => ipcClient.invoke(IPCEventType.fsDirExists, { path }),
        isFile: (path: string) => ipcClient.invoke(IPCEventType.fsIsFile, { path }),
        isDir: (path: string) => ipcClient.invoke(IPCEventType.fsIsDir, { path }),
        selectFile: (filters: string[], multiple: boolean) => ipcClient.invoke(IPCEventType.fsSelectFile, { filters, multiple }),
        selectDirectory: (multiple: boolean) => ipcClient.invoke(IPCEventType.fsSelectDirectory, { multiple }),
        grantFileAccessForFiles: (files: ArrayLike<File>) => grantFileAccessForFiles(files),
        hash: (path: string) => ipcClient.invoke(IPCEventType.fsHash, { path }),
        getPathForFile: (file: File) => getPathForFile(file),
    },
    selectProjectDirectory: () => ipcClient.invoke(IPCEventType.projectWizardSelectDirectory, {}),
    
    // Workspace
    selectFolder: () => ipcClient.invoke(IPCEventType.workspaceSelectFolder, {}),
    openPsd: () => ipcClient.invoke(IPCEventType.psdOpen, {}),
    bakePsd: (request) => ipcClient.invoke(IPCEventType.psdBake, { request }),
    probeMedia: (path: string) => ipcClient.invoke(IPCEventType.mediaProbe, { path }),
    mediaConvert: {
        start: (request: MediaConvertRequest) =>
            ipcClient.invoke(IPCEventType.mediaConvertStart, { request }) as Promise<RequestStatus<{ state: MediaConvertStateSnapshot }>>,
        cancel: (jobId: string) =>
            ipcClient.invoke(IPCEventType.mediaConvertCancel, { jobId }) as Promise<RequestStatus<{ state: MediaConvertStateSnapshot }>>,
        getStatus: (jobId: string) =>
            ipcClient.invoke(IPCEventType.mediaConvertGetStatus, { jobId }) as Promise<RequestStatus<{ state: MediaConvertStateSnapshot }>>,
    },
    workspace: {
        getDefaultProjectDirectory: () => ipcClient.invoke(IPCEventType.projectWizardGetDefaultDirectory, {}),
        launch: (props: WindowProps[WindowAppType.Workspace], closeCurrentWindow?: boolean) =>
            ipcClient.invoke(IPCEventType.workspaceLaunch, { props, closeCurrentWindow }),
        openRecent: (projectPath: string, replaceCurrentWindow?: boolean) =>
            ipcClient.invoke(IPCEventType.workspaceOpenRecent, { projectPath, replaceCurrentWindow }),
        close: () => ipcClient.invoke(IPCEventType.workspaceClose, {}),
        exportProjectPackage: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.workspaceExportProjectPackage, { projectPath }),
        importProjectPackage: () =>
            ipcClient.invoke(IPCEventType.workspaceImportProjectPackage, {}),
        exportConsoleLogs: (defaultFileName: string, content: string) =>
            ipcClient.invoke(IPCEventType.workspaceExportConsoleLogs, { defaultFileName, content }),
        setRecoveryMode: (enabled: boolean, reason?: string) =>
            ipcClient.invoke(IPCEventType.workspaceSetRecoveryMode, { enabled, reason }),
        openProjectFolder: () =>
            ipcClient.invoke(IPCEventType.workspaceOpenProjectFolder, {}),
        onConfirmClose: (handler: () => Promise<RequestStatus<{ confirmed: boolean }>>) =>
            ipcClient.onRequest(IPCEventType.workspaceConfirmClose, handler),
        onFlushPendingSaves: (handler: () => Promise<RequestStatus<{ flushed: boolean }>>) =>
            ipcClient.onRequest(IPCEventType.workspaceFlushPendingSaves, handler),
        onCloseProgress: (handler: (stage: WorkspaceCloseStage | null) => void) =>
            ipcClient.onMessage(IPCEventType.workspaceCloseProgress, (data) => handler(data.stage)),
        onResolveAssetUrl: (handler: (payload: { assetId: string; assetType?: string }) => Promise<RequestStatus<{ url: string }>>) =>
            ipcClient.onRequest(IPCEventType.workspaceResolveAssetUrl, handler),
        onResolveImageAssetUrl: (handler: (payload: { assetId: string }) => Promise<RequestStatus<{ url: string }>>) =>
            ipcClient.onRequest(IPCEventType.workspaceResolveImageAssetUrl, handler),
        onBlueprintNavigateFromPreview: (handler: (payload: PreviewStudioBlueprintOpenPayload) => void) =>
            ipcClient.onMessage(IPCEventType.workspaceBlueprintNavigateFromPreview, handler),
        onMenuAction: (handler: (action: MenuActionId) => void) =>
            ipcClient.onMessage(IPCEventType.menuAction, (data) => handler(data.action)),
        syncNativeMenu: (model: NativeMenuModel) =>
            ipcClient.send(IPCEventType.workspaceMenuSync, { model }),
        reportLoadResult: (ok: boolean) =>
            ipcClient.send(IPCEventType.workspaceReportLoadResult, { ok }),
        reportWriteFreeze: (reason: WorkspaceFreezeKind | null, revision?: RevisionId) =>
            ipcClient.send(IPCEventType.workspaceReportWriteFreeze, { reason, revision }),
        onOpenViewRequest: (handler: (view: WorkspaceViewRequest) => void) =>
            ipcClient.onMessage(IPCEventType.workspaceOpenView, (data) => handler(data.view)),
    },

    app: {
        launchSettings: (props: WindowProps[WindowAppType.Settings]) => ipcClient.invoke(IPCEventType.appLaunchSettings, { props }),
        onSettingsHighlight: (handler: (highlight: string) => void) =>
            ipcClient.onMessage(IPCEventType.settingsHighlight, (data) => handler(data.highlight)),
        countWorkspaceWindows: () => ipcClient.invoke(IPCEventType.appCountWorkspaceWindows, {}),
        requestWorkspaceView: (view: WorkspaceViewRequest) => ipcClient.invoke(IPCEventType.appRequestWorkspaceView, { view }),
        openExternal: (url: string) => ipcClient.invoke(IPCEventType.appOpenExternal, { url }),
        pickBackgroundImage: () => ipcClient.invoke(IPCEventType.appPickBackgroundImage, {}),
        readBackgroundImage: (file: string) => ipcClient.invoke(IPCEventType.appReadBackgroundImage, { file }),
        launchProjectWizard: () => ipcClient.invoke(IPCEventType.projectWizardLaunch, {}) as Promise<RequestStatus<{created: boolean; projectPath: string} | null>>,    
        state: {
            getGlobalState: <K extends GlobalStateKeys>(key: K) => ipcClient.invoke(IPCEventType.appGlobalStateGet, { key }) as Promise<RequestStatus<{value: GlobalStateValue<K>}>>,
            setGlobalState: <K extends GlobalStateKeys>(key: K, value: GlobalStateValue<K>) => ipcClient.invoke(IPCEventType.appGlobalStateSet, { key, value }) as Promise<RequestStatus<void>>,
            getAllGlobalState: () =>
                ipcClient.invoke(IPCEventType.appGlobalStateGetAll, {}) as Promise<RequestStatus<{ settings: Record<string, any> }>>,
            deleteGlobalState: (keys: string[]) =>
                ipcClient.invoke(IPCEventType.appGlobalStateDelete, { keys }) as Promise<RequestStatus<{ deleted: string[]; refused: string[] }>>,
            onGlobalStateChanged: (handler: (change: { key: GlobalStateKeys; value: any }) => void) =>
                ipcClient.onMessage(IPCEventType.appGlobalStateChanged, handler),
        },
        addRecentProject: (name: string, path: string) =>
            ipcClient.invoke(IPCEventType.appAddRecentProject, { name, path }) as Promise<RequestStatus<void>>,
        removeRecentProject: (path: string) =>
            ipcClient.invoke(IPCEventType.appRemoveRecentProject, { path }) as Promise<RequestStatus<void>>,
        checkRecentProjects: () =>
            ipcClient.invoke(IPCEventType.appCheckRecentProjects, {}) as Promise<RequestStatus<{ missing: MissingRecentProject[] }>>,
        getSystemPath: (name: "desktop" | "home") =>
            ipcClient.invoke(IPCEventType.appSystemPath, { name }) as Promise<RequestStatus<{ path: string }>>,
        exportDiagnostics: (defaultFileName: string, report: string) =>
            ipcClient.invoke(IPCEventType.appExportDiagnostics, { defaultFileName, report }),
        probeDownloadSource: (url: string) =>
            ipcClient.invoke(IPCEventType.appProbeDownloadSource, { url }),
        getCacheInventory: () =>
            ipcClient.invoke(IPCEventType.appCacheInventory, {}),
        clearCaches: (ids: string[]) =>
            ipcClient.invoke(IPCEventType.appCacheClear, { ids }),
        exportSettings: (defaultFileName: string, content: string) =>
            ipcClient.invoke(IPCEventType.appExportSettings, { defaultFileName, content }),
        importSettings: () =>
            ipcClient.invoke(IPCEventType.appImportSettings, {}),
    },

    devMode: {
        launch: (projectPath: string, entry: DevModeEntry) =>
            ipcClient.invoke(IPCEventType.devModeLaunch, { projectPath, entry }) as Promise<RequestStatus<{ status: DevModeStatus }>>,
        stop: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.devModeStop, { projectPath }) as Promise<RequestStatus<{ status: DevModeStatus }>>,
        reload: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.devModeReload, { projectPath }) as Promise<RequestStatus<{ status: DevModeStatus }>>,
        getStatus: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.devModeGetStatus, { projectPath }) as Promise<RequestStatus<{ status: DevModeStatus }>>,
        getFullscreen: () =>
            ipcClient.invoke(IPCEventType.devModeFullscreenGet, {}) as Promise<RequestStatus<{ isFullscreen: boolean }>>,
        setFullscreen: (fullscreen: boolean) =>
            ipcClient.invoke(IPCEventType.devModeFullscreenSet, { fullscreen }) as Promise<RequestStatus<void>>,
        onFullscreenChanged: (handler: (payload: { isFullscreen: boolean }) => void) =>
            ipcClient.onMessage(IPCEventType.devModeFullscreenChanged, handler),
        onCloseRequested: (handler: () => Promise<RequestStatus<{ allow: boolean }>>) =>
            ipcClient.onRequest(IPCEventType.devModeWindowCloseRequested, handler),
        onPayloadUpdate: (handler: (payload: { bundle: DevModeBundle }) => void) =>
            ipcClient.onMessage(IPCEventType.devModePayloadUpdate, handler),
        onControlReload: (handler: (payload: { revision: number }) => void) =>
            ipcClient.onMessage(IPCEventType.devModeControlReload, handler),
        onControlError: (handler: (payload: { message: string }) => void) =>
            ipcClient.onMessage(IPCEventType.devModeControlError, handler),
        onConsoleLog: (handler: (payload: DevModeConsoleLogPayload) => void) =>
            ipcClient.onMessage(IPCEventType.workspaceDevModeConsoleLog, handler),
        onBlueprintDebugEvent: (handler: (event: BlueprintDebugEvent) => void) =>
            ipcClient.onMessage(IPCEventType.workspaceBlueprintDebugEvent, handler),
        forwardBlueprintDebugEvent: (payload: DevModeBlueprintDebugEventPayload) =>
            ipcClient.send(IPCEventType.devModeForwardBlueprintDebugEvent, payload),
        forwardStoryRow: (payload: DevModeStoryRowPayload) =>
            ipcClient.send(IPCEventType.devModeForwardStoryRow, payload),
        onStoryRowHighlight: (handler: (payload: DevModeStoryRowHighlight) => void) =>
            ipcClient.onMessage(IPCEventType.workspaceStoryRowHighlight, handler),
        openStoryRowInWorkspace: (payload: DevModeStoryRowOpenPayload) =>
            ipcClient.invoke(IPCEventType.devModeOpenStoryRowInWorkspace, payload) as Promise<RequestStatus<void>>,
        onStoryRowOpen: (handler: (payload: DevModeStoryRowOpenRequest) => void) =>
            ipcClient.onMessage(IPCEventType.workspaceStoryRowOpen, handler),
        resolveAssetUrl: (assetId: string, assetType?: string) =>
            ipcClient.invoke(IPCEventType.devModeResolveAssetUrl, { assetId, assetType }) as Promise<RequestStatus<{ url: string }>>,
        resolveImageAssetUrl: (assetId: string) =>
            ipcClient.invoke(IPCEventType.devModeResolveImageAssetUrl, { assetId }) as Promise<RequestStatus<{ url: string }>>,
        openBlueprintInWorkspace: (payload: PreviewStudioBlueprintOpenPayload & { projectPath: string }) =>
            ipcClient.invoke(IPCEventType.devModeOpenBlueprintInWorkspace, payload) as Promise<RequestStatus<void>>,
        save: {
            write: (
                projectRef: DevModeSaveProjectRef,
                id: string,
                savedGame: unknown,
                capture?: string,
                metadata?: unknown,
            ) =>
                ipcClient.invoke(IPCEventType.devModeSaveWrite, {
                    projectRef,
                    id,
                    savedGame,
                    capture,
                    metadata,
                }) as Promise<RequestStatus<void>>,
            read: (projectRef: DevModeSaveProjectRef, id: string) =>
                ipcClient.invoke(IPCEventType.devModeSaveRead, { projectRef, id }) as Promise<RequestStatus<{ record: DevModeSaveRecord | null }>>,
            listIds: (projectRef: DevModeSaveProjectRef) =>
                ipcClient.invoke(IPCEventType.devModeSaveListIds, { projectRef }) as Promise<RequestStatus<{ ids: string[] }>>,
            readPreview: (projectRef: DevModeSaveProjectRef, id: string) =>
                ipcClient.invoke(IPCEventType.devModeSaveReadPreview, { projectRef, id }) as Promise<RequestStatus<{ capture: string | null }>>,
            delete: (projectRef: DevModeSaveProjectRef, id: string) =>
                ipcClient.invoke(IPCEventType.devModeSaveDelete, { projectRef, id }) as Promise<RequestStatus<{ deleted: boolean }>>,
        },
    },

    preview: {
        launch: (projectPath: string, entry: GameRuntimeLaunchEntry) =>
            ipcClient.invoke(IPCEventType.previewLaunch, { projectPath, entry }) as Promise<RequestStatus<{ status: PreviewStatus }>>,
        stop: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.previewStop, { projectPath }) as Promise<RequestStatus<{ status: PreviewStatus }>>,
        getStatus: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.previewGetStatus, { projectPath }) as Promise<RequestStatus<{ status: PreviewStatus }>>,
    },

    /**
     * Game processes owned by a test run.
     *
     * No `getStatus`, unlike `preview`: everything a test needs to know arrives on `onEvent`, in
     * order. A polled status cannot tell the two exits a test cares about apart - the author closing
     * the window and the process dying - which is the reason this namespace exists next to `preview`
     * rather than inside it. A launch that is refused (frozen workspace, a session already running,
     * a failed compile) still resolves successfully, carrying `{ok:false, reason}`.
     */
    gameTest: {
        launch: (request: GameTestLaunchRequest) =>
            ipcClient.invoke(IPCEventType.gameTestLaunch, request) as Promise<RequestStatus<GameTestLaunchResult>>,
        stop: (projectPath: string, sessionId: string) =>
            ipcClient.invoke(IPCEventType.gameTestStop, { projectPath, sessionId }) as Promise<RequestStatus<void>>,
        onEvent: (handler: (payload: GameTestEventPayload) => void) =>
            ipcClient.onMessage(IPCEventType.workspaceGameTestEvent, handler),
    },

    /**
     * Version control. Reads, the writes that produce a revision (`initRepository`, `commit`,
     * `checkpoint`), and `restoreRevision` - the only one that overwrites the author's files.
     * Merge, which is the write that needs a conflict story, is still deliberately absent.
     * Blobs arrive base64-encoded - decode at the call site that needs bytes.
     */
    vcs: {
        /** Ask first: VCS is optional and absent on macOS Intel / Windows ARM64. */
        getAvailability: () =>
            ipcClient.invoke(IPCEventType.vcsGetAvailability, {}) as Promise<RequestStatus<VcsAvailability>>,
        isRepository: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.vcsIsRepository, { projectPath }) as Promise<RequestStatus<{ isRepository: boolean }>>,
        getInfo: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.vcsGetInfo, { projectPath }) as Promise<RequestStatus<VcsRepositoryInfo>>,
        /** Creates `.lore/` in the project and commits it. The author's decision, never Studio's. */
        initRepository: (projectPath: string, options?: VcsInitOptions) =>
            ipcClient.invoke(IPCEventType.vcsInitRepository, { projectPath, options }) as Promise<RequestStatus<VcsRepositoryInfo>>,
        /**
         * Scans the working tree. On demand only: the scan records newly found
         * directories into staged state, so polling it invents deletions (§4.17).
         */
        getStatus: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.vcsGetStatus, { projectPath }) as Promise<RequestStatus<VcsStatus>>,
        /**
         * Flushes the renderer's pending saves, stages, commits, and forces Lore's
         * stores to disk before answering. Slow by nature; await it and show the error.
         */
        commit: (projectPath: string, options?: VcsCommitOptions) =>
            ipcClient.invoke(IPCEventType.vcsCommit, { projectPath, options }) as Promise<RequestStatus<VcsCommitResult>>,
        /** Same pipeline, labelled a checkpoint. `revision: null` = nothing to record. */
        checkpoint: (projectPath: string, reason: VcsCheckpointReason) =>
            ipcClient.invoke(IPCEventType.vcsCheckpoint, { projectPath, reason }) as Promise<RequestStatus<{ revision: VcsCommitResult | null }>>,
        /**
         * Write one revision's content over the working tree and record it as a new revision.
         *
         * The only call here that touches the author's files. It checkpoints first (and aborts if
         * it cannot), and it never removes a revision - `#12` restored at `#61` produces `#62`.
         * The caller must leave any revision view and re-read every document afterwards.
         */
        restoreRevision: (projectPath: string, revision: RevisionId, options?: VcsRestoreOptions) =>
            ipcClient.invoke(IPCEventType.vcsRestoreRevision, { projectPath, revision, options }) as Promise<RequestStatus<VcsRestoreResult>>,
        /**
         * `includeDetails` costs one call per revision; leave it off unless the details
         * are shown. One call carries the kind, message, timestamp and author together.
         */
        getHistory: (projectPath: string, limit?: number, includeDetails?: boolean) =>
            ipcClient.invoke(IPCEventType.vcsGetHistory, { projectPath, limit, includeDetails }) as Promise<RequestStatus<{ entries: VcsHistoryEntry[] }>>,
        readBlob: (projectPath: string, revision: RevisionId, path: string) =>
            ipcClient.invoke(IPCEventType.vcsReadBlob, { projectPath, revision, path }) as Promise<RequestStatus<{ contentBase64: string }>>,
        /** Every document at one revision in one round trip; `contentBase64: null` = absent there. */
        readRevisionDocuments: (projectPath: string, revision: RevisionId, paths?: string[]) =>
            ipcClient.invoke(IPCEventType.vcsReadRevisionDocuments, { projectPath, revision, paths }) as Promise<RequestStatus<{ documents: { path: string; contentBase64: string | null }[] }>>,
        getChangedPaths: (projectPath: string, from: RevisionId, to: RevisionId) =>
            ipcClient.invoke(IPCEventType.vcsGetChangedPaths, { projectPath, from, to }) as Promise<RequestStatus<{ paths: string[] }>>,
        /** Changes between two revisions. Cached in main - sound only because revisions are immutable. */
        diffRevisions: (projectPath: string, from: RevisionId, to: RevisionId) =>
            ipcClient.invoke(IPCEventType.vcsDiffRevisions, { projectPath, from, to }) as Promise<RequestStatus<VcsRevisionDiffResult>>,
        /** Changes since the last version. Never cached, and never on a timer - it scans (docs §4.17). */
        diffWorkingTree: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.vcsDiffWorkingTree, { projectPath }) as Promise<RequestStatus<VcsWorkingTreeDiffResult>>,
        getThreeWay: (projectPath: string, mine: RevisionId, theirs: RevisionId, path: string) =>
            ipcClient.invoke(IPCEventType.vcsGetThreeWay, { projectPath, mine, theirs, path }) as Promise<RequestStatus<VcsThreeWayResult>>,
        getMergeBase: (projectPath: string, a: RevisionId, b: RevisionId) =>
            ipcClient.invoke(IPCEventType.vcsGetMergeBase, { projectPath, a, b }) as Promise<RequestStatus<{ base?: RevisionId }>>,
        /** Is a merge open here? Repository state, so ask on project open, not only after a sync. */
        getMergeState: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.vcsGetMergeState, { projectPath }) as Promise<RequestStatus<VcsMergeState>>,
        /**
         * Tier two: the three-way merge of ONE conflicted document, change by change.
         *
         * Reads the three copies the merge left beside the file; records nothing. `blocked` set
         * means this path stays at tier one and says why - not every document can be settled this
         * way, and the difference has to be visible rather than a missing control.
         */
        getMergeDocument: (projectPath: string, path: string) =>
            ipcClient.invoke(IPCEventType.vcsGetMergeDocument, { projectPath, path }) as Promise<RequestStatus<VcsMergeDocument>>,
        /** Settles paths; records nothing. `mine`/`theirs` rewrite the working tree - re-read them. */
        resolveConflicts: (projectPath: string, paths: string[], choice: VcsConflictChoice) =>
            ipcClient.invoke(IPCEventType.vcsResolveConflicts, { projectPath, paths, choice }) as Promise<RequestStatus<VcsMergeResolveResult>>,
        /** Takes one side per path AND commits, as one act. Writes files: re-read afterwards. */
        completeMerge: (projectPath: string, decisions: VcsMergeDecision[], options?: VcsCommitOptions) =>
            ipcClient.invoke(IPCEventType.vcsCompleteMerge, { projectPath, decisions, options }) as Promise<RequestStatus<VcsMergeCompletion>>,
        unresolveConflicts: (projectPath: string, paths: string[]) =>
            ipcClient.invoke(IPCEventType.vcsUnresolveConflicts, { projectPath, paths }) as Promise<RequestStatus<VcsMergeResolveResult>>,
        /** Merges these paths again, discarding the working-tree bytes for them. */
        restartConflicts: (projectPath: string, paths: string[]) =>
            ipcClient.invoke(IPCEventType.vcsRestartConflicts, { projectPath, paths }) as Promise<RequestStatus<VcsMergeState>>,
        /** Full rollback to before the merge (measured). Re-read every document afterwards. */
        abortMerge: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.vcsAbortMerge, { projectPath }) as Promise<RequestStatus<VcsMergeState>>,
        /** Local read - no socket. Null means the project has no server. */
        getRemote: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.vcsGetRemote, { projectPath }) as Promise<RequestStatus<{ url: string | null }>>,
        /** Local write - does NOT contact the server. `null` disconnects. */
        setRemote: (projectPath: string, url: string | null) =>
            ipcClient.invoke(IPCEventType.vcsSetRemote, { projectPath, url }) as Promise<RequestStatus<{ url: string | null }>>,
        /** Goes to the network; ~2s when nothing answers. On demand only, never on a timer. */
        getSyncState: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.vcsGetSyncState, { projectPath }) as Promise<RequestStatus<VcsSyncState>>,
        push: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.vcsPush, { projectPath }) as Promise<RequestStatus<VcsPushResult>>,
        /** Writes the working tree: re-read every document once this resolves. */
        sync: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.vcsSync, { projectPath }) as Promise<RequestStatus<VcsSyncResult>>,
        /** Destination must be an empty (or missing) folder. */
        clone: (url: string, destination: string) =>
            ipcClient.invoke(IPCEventType.vcsClone, { url, destination }) as Promise<RequestStatus<{ root: string; branch: string; fileCount: number }>>,
    },

    gameBuild: {
        start: (projectPath: string, entry: GameRuntimeLaunchEntry, request: GameBuildRequest) =>
            ipcClient.invoke(IPCEventType.gameBuildStart, { projectPath, entry, request }) as Promise<RequestStatus<{ state: GameBuildStateSnapshot }>>,
        cancel: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.gameBuildCancel, { projectPath }) as Promise<RequestStatus<{ state: GameBuildStateSnapshot }>>,
        getStatus: (projectPath: string) =>
            ipcClient.invoke(IPCEventType.gameBuildGetStatus, { projectPath }) as Promise<RequestStatus<{ state: GameBuildStateSnapshot }>>,
        selectOutputDir: (defaultPath?: string) =>
            ipcClient.invoke(IPCEventType.gameBuildSelectOutputDir, { defaultPath }) as Promise<RequestStatus<{ path: string | null }>>,
        preflight: (projectPath: string, request: GameBuildRequest) =>
            ipcClient.invoke(IPCEventType.gameBuildPreflight, { projectPath, request }) as Promise<RequestStatus<{ findings: BuildPreflightFinding[] }>>,
    },

    /**
     * The machine's code-signing credential vault. Nothing here returns a
     * password: `import` sends the plain secrets up once and everything else
     * deals in the redacted credential.
     */
    signing: {
        list: () =>
            ipcClient.invoke(IPCEventType.signingList, {}) as Promise<RequestStatus<{ credentials: SigningCredential[] }>>,
        /** `input` holds plain passwords. Do not log it or keep it after the call. */
        import: (input: SigningCredentialImport) =>
            ipcClient.invoke(IPCEventType.signingImport, { input }) as Promise<RequestStatus<{ credential: SigningCredential }>>,
        remove: (id: string) =>
            ipcClient.invoke(IPCEventType.signingRemove, { id }) as Promise<RequestStatus<{ removed: boolean }>>,
        inspect: (id: string) =>
            ipcClient.invoke(IPCEventType.signingInspect, { id }) as Promise<RequestStatus<SigningInspectResult>>,
        /** `storePassword` is plain text. Do not log it or keep it after the call. */
        keystoreAliases: (file: string, storePassword: string) =>
            ipcClient.invoke(IPCEventType.signingKeystoreAliases, { file, storePassword }) as Promise<RequestStatus<{ aliases: string[] }>>,
        /** The code-signing identities in this Mac's keychains; empty on other hosts. */
        macIdentities: () =>
            ipcClient.invoke(IPCEventType.signingMacIdentities, {}) as Promise<RequestStatus<{ identities: MacSigningIdentity[] }>>,
    },

    blueprintPersistence: {
        getAll: (projectRef: BlueprintPersistenceProjectRef) =>
            ipcClient.invoke(IPCEventType.blueprintPersistenceGetAll, { projectRef }) as Promise<RequestStatus<{ values: Record<string, unknown> }>>,
        getValue: (projectRef: BlueprintPersistenceProjectRef, key: string) =>
            ipcClient.invoke(IPCEventType.blueprintPersistenceGetValue, { projectRef, key }) as Promise<RequestStatus<{ value: unknown }>>,
        setValue: (projectRef: BlueprintPersistenceProjectRef, key: string, value: unknown) =>
            ipcClient.invoke(IPCEventType.blueprintPersistenceSetValue, { projectRef, key, value }) as Promise<RequestStatus<void>>,
        removeValue: (projectRef: BlueprintPersistenceProjectRef, key: string) =>
            ipcClient.invoke(IPCEventType.blueprintPersistenceRemoveValue, { projectRef, key }) as Promise<RequestStatus<void>>,
    },

    blueprintNetwork: {
        fetch: (projectPath: string, request: BlueprintNetworkFetchRequest) =>
            ipcClient.invoke(IPCEventType.blueprintNetworkFetch, { projectPath, request }) as Promise<
                RequestStatus<{ result: BlueprintNetworkFetchResult }>
            >,
    },

    pluginPermissions: {
        request: (request: PluginPermissionRequest) =>
            ipcClient.invoke(IPCEventType.pluginPermissionPromptLaunch, { props: { request } }),
        grant: (request: PluginPermissionRequest, decision: PluginPermissionDecision) =>
            ipcClient.invoke(IPCEventType.pluginPermissionGrant, { request, decision }),
    },

    plugins: {
        list: () => ipcClient.invoke(IPCEventType.pluginList, {}),
        installLocal: () => ipcClient.invoke(IPCEventType.pluginInstallLocal, {}),
        setEnabled: (pluginId: string, enabled: boolean) =>
            ipcClient.invoke(IPCEventType.pluginSetEnabled, { pluginId, enabled }),
        approve: (pluginId: string) =>
            ipcClient.invoke(IPCEventType.pluginApprove, { pluginId }),
        uninstall: (pluginId: string) =>
            ipcClient.invoke(IPCEventType.pluginUninstall, { pluginId }),
        revoke: (pluginId: string) =>
            ipcClient.invoke(IPCEventType.pluginRevoke, { pluginId }),
        getWorkspacePlugins: () =>
            ipcClient.invoke(IPCEventType.pluginWorkspaceList, {}),
        getRuntimePlugins: () =>
            ipcClient.invoke(IPCEventType.pluginRuntimeList, {}),
        reportLoadError: (pluginId: string, error: string | null) =>
            ipcClient.invoke(IPCEventType.pluginReportLoadError, { pluginId, error }),
        getLocaleContributions: () =>
            ipcClient.invoke(IPCEventType.pluginLocaleList, {}),
        onLocalesChanged: (handler: (change: { version: number }) => void) =>
            ipcClient.onMessage(IPCEventType.pluginLocalesChanged, handler),
        registryFetch: () =>
            ipcClient.invoke(IPCEventType.pluginRegistryFetch, {}),
        registryIcon: (pluginId: string) =>
            ipcClient.invoke(IPCEventType.pluginRegistryIcon, { pluginId }),
        installFromRegistry: (pluginId: string) =>
            ipcClient.invoke(IPCEventType.pluginInstallFromRegistry, { pluginId }),
    },

    uiTemplates: {
        registryFetch: () =>
            ipcClient.invoke(IPCEventType.uiTemplateRegistryFetch, {}),
        fetchBundle: (templateId: string) =>
            ipcClient.invoke(IPCEventType.uiTemplateFetchBundle, { templateId }),
        fetchPreviews: (templateIds: string[]) =>
            ipcClient.invoke(IPCEventType.uiTemplateFetchPreviews, { templateIds }),
        fetchThemePreviews: (themeIds: string[]) =>
            ipcClient.invoke(IPCEventType.uiTemplateFetchThemePreviews, { themeIds }),
    },

    projectTemplates: {
        list: () =>
            ipcClient.invoke(IPCEventType.projectTemplateList, {}),
        scaffold: (templateId: string, projectPath: string) =>
            ipcClient.invoke(IPCEventType.projectTemplateScaffold, { templateId, projectPath }),
    },

    assets: {
        fetchRemote: (url: string, validators?: RemoteAssetValidators) =>
            ipcClient.invoke(IPCEventType.assetFetchRemote, { url, validators }),
        exportToFolder: (entries: AssetExportEntry[]) =>
            ipcClient.invoke(IPCEventType.assetExportToFolder, { entries }),
    },

    puppetRuntimes: {
        installSdk: (runtimeId: string, projectPath: string, archivePath: string) =>
            ipcClient.invoke(IPCEventType.puppetRuntimeInstallSdk, { runtimeId, projectPath, archivePath }),
    },

    privileged: privilegedBootstrapBridge,
};

function getPathForFile(file: File): string {
    try {
        return webUtils.getPathForFile(file);
    } catch {
        return "";
    }
}

function grantFileAccessForFiles(files: ArrayLike<File>) {
    if (!files || typeof files.length !== "number") {
        return ipcClient.invoke(IPCEventType.fsGrantFileAccess, { paths: [] });
    }

    const paths = Array.from(files)
        .map(file => getPathForFile(file))
        .filter((path): path is string => path.length > 0);

    return ipcClient.invoke(IPCEventType.fsGrantFileAccess, { paths });
}
