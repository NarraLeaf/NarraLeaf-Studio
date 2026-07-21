import { RendererInterfaceKey } from "@shared/types/constants";
import { Namespace } from "@shared/types/ipc";
import { IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { EditMenuRole, MenuActionId, NativeMenuModel } from "@shared/types/menu";
import type { BlueprintPersistenceProjectRef } from "@shared/types/ipcEvents";
import { GlobalStateKeys, GlobalStateValue } from "@shared/types/state/globalState";
import { WindowAppType, WindowControlAbility, WindowProps, WindowCloseResults, WorkspaceViewRequest } from "@shared/types/window";
import type { DevModeBlueprintDebugEventPayload, DevModeEntry, DevModeStatus, DevModeBundle, DevModeConsoleLogPayload } from "@shared/types/devMode";
import type { GameRuntimeLaunchEntry, PreviewStatus } from "@shared/types/gameRuntime";
import type { BuildPreflightFinding, GameBuildRequest, GameBuildStateSnapshot } from "@shared/types/gameBuild";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { DevModeSaveProjectRef, DevModeSaveRecord } from "@shared/types/devModeSave";
import type { PreviewStudioBlueprintOpenPayload } from "@shared/types/previewStudioBlueprintOpen";
import type { PluginPermissionDecision, PluginPermissionRequest } from "@shared/types/pluginPermissions";
import type { PrivilegedActor } from "@shared/types/privileged";
import type { RevisionId, VcsAvailability, VcsHistoryEntry, VcsRepositoryInfo, VcsThreeWayResult } from "@shared/types/vcs";
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
            selectFile: (actor: PrivilegedActor, filters: string[], multiple: boolean) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "selectFile", filters, multiple }),
            selectSaveFile: (actor: PrivilegedActor, defaultFileName: string, filters: string[]) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "selectSaveFile", defaultFileName, filters }),
            stat: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "stat", path }),
            list: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "list", path }),
            details: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "details", path }),
            requestRead: (actor: PrivilegedActor, path: string, encoding: BufferEncoding) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "requestRead", path, encoding, raw: false }),
            requestReadRaw: (actor: PrivilegedActor, path: string) =>
                invoke(IPCEventType.privilegedFsCall, { actor, operation: "requestRead", path, raw: true }),
            requestWrite: (actor: PrivilegedActor, path: string, encoding: BufferEncoding) =>
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
        requestRead: (path: string, encoding: BufferEncoding) => ipcClient.invoke(IPCEventType.fsRequestRead, { path, encoding, raw: false }),
        requestReadRaw: (path: string) => ipcClient.invoke(IPCEventType.fsRequestRead, { path, raw: true }),
        requestWrite: (path: string, encoding: BufferEncoding) => ipcClient.invoke(IPCEventType.fsRequestWrite, { path, encoding, raw: false }),
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
        onConfirmClose: (handler: () => Promise<RequestStatus<{ confirmed: boolean }>>) =>
            ipcClient.onRequest(IPCEventType.workspaceConfirmClose, handler),
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
            onGlobalStateChanged: (handler: (change: { key: GlobalStateKeys; value: any }) => void) =>
                ipcClient.onMessage(IPCEventType.appGlobalStateChanged, handler),
        },
        addRecentProject: (name: string, path: string) =>
            ipcClient.invoke(IPCEventType.appAddRecentProject, { name, path }) as Promise<RequestStatus<void>>,
        removeRecentProject: (path: string) =>
            ipcClient.invoke(IPCEventType.appRemoveRecentProject, { path }) as Promise<RequestStatus<void>>,
        getSystemPath: (name: "desktop") =>
            ipcClient.invoke(IPCEventType.appSystemPath, { name }) as Promise<RequestStatus<{ path: string }>>,
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
     * Version control. Read-only for now; writes wait on the resolve UI.
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
        getHistory: (projectPath: string, limit?: number) =>
            ipcClient.invoke(IPCEventType.vcsGetHistory, { projectPath, limit }) as Promise<RequestStatus<{ entries: VcsHistoryEntry[] }>>,
        readBlob: (projectPath: string, revision: RevisionId, path: string) =>
            ipcClient.invoke(IPCEventType.vcsReadBlob, { projectPath, revision, path }) as Promise<RequestStatus<{ contentBase64: string }>>,
        getChangedPaths: (projectPath: string, from: RevisionId, to: RevisionId) =>
            ipcClient.invoke(IPCEventType.vcsGetChangedPaths, { projectPath, from, to }) as Promise<RequestStatus<{ paths: string[] }>>,
        getThreeWay: (projectPath: string, mine: RevisionId, theirs: RevisionId, path: string) =>
            ipcClient.invoke(IPCEventType.vcsGetThreeWay, { projectPath, mine, theirs, path }) as Promise<RequestStatus<VcsThreeWayResult>>,
        getMergeBase: (projectPath: string, a: RevisionId, b: RevisionId) =>
            ipcClient.invoke(IPCEventType.vcsGetMergeBase, { projectPath, a, b }) as Promise<RequestStatus<{ base?: RevisionId }>>,
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
