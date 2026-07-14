import { FileDetails, FileStat } from "@shared/utils/fs";
import { AppInfo } from "./app";
import { RendererInterfaceKey } from "./constants";
import { BlueprintPersistenceProjectRef, RequestStatus, WorkspaceMenuAction } from "./ipcEvents";
import { FsRequestResult, PlatformInfo } from "./os";
import { WindowAppType, WindowProps, WindowVisibilityStatus, WindowControlAbility, WindowCloseResults } from "./window";
import { GlobalStateValue } from "./state/globalState";
import { GlobalStateKeys } from "./state/globalState";
import { DevModeBlueprintDebugEventPayload, DevModeBundle, DevModeConsoleLogPayload, DevModeEntry, DevModeStatus } from "./devMode";
import type { GameRuntimeLaunchEntry, PreviewStatus } from "./gameRuntime";
import type { GameBuildRequest, GameBuildStateSnapshot } from "./gameBuild";
import type { BlueprintDebugEvent } from "./blueprint/debug";
import type { DevModeSaveProjectRef, DevModeSaveRecord } from "./devModeSave";
import type { PreviewStudioBlueprintOpenPayload } from "./previewStudioBlueprintOpen";
import type {
    PluginPermissionDecision,
    PluginPermissionGrantResult,
    PluginPermissionPromptResult,
    PluginPermissionRequest,
} from "./pluginPermissions";
import type {
    PluginApproveResult,
    PluginInstallResult,
    PluginListItem,
    RuntimePluginDescriptor,
    WorkspacePluginDescriptor,
} from "./plugins";
import type {
    PrivilegedActor,
    PrivilegedBashExecuteResult,
} from "./privileged";
import { AppEventToken } from "./app";

export interface RendererPrivilegedInterface {
    fs: {
        selectFile(actor: PrivilegedActor, filters: string[], multiple: boolean): Promise<RequestStatus<FsRequestResult<string[]>>>;
        /** Native save dialog; resolves to the chosen path, or null when cancelled. */
        selectSaveFile(actor: PrivilegedActor, defaultFileName: string, filters: string[]): Promise<RequestStatus<FsRequestResult<string | null>>>;
        stat(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<FileStat>>>;
        list(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<FileStat[]>>>;
        details(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<FileDetails>>>;
        requestRead(actor: PrivilegedActor, path: string, encoding: BufferEncoding): Promise<RequestStatus<FsRequestResult<string>>>;
        requestReadRaw(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<string>>>;
        requestWrite(actor: PrivilegedActor, path: string, encoding: BufferEncoding): Promise<RequestStatus<FsRequestResult<string>>>;
        requestWriteRaw(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<string>>>;
        ensureRegularFile(actor: PrivilegedActor, path: string, data: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>>;
        writeFileNoFollow(actor: PrivilegedActor, path: string, data: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>>;
        recoverCorruptedJsonFile(actor: PrivilegedActor, path: string, replacement: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>>;
        createDir(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<void>>>;
        deleteFile(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<void>>>;
        deleteDir(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<void>>>;
        rename(actor: PrivilegedActor, oldPath: string, newName: string, isDir: boolean): Promise<RequestStatus<FsRequestResult<void>>>;
        copyFile(actor: PrivilegedActor, src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        copyDir(actor: PrivilegedActor, src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        moveFile(actor: PrivilegedActor, src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        moveDir(actor: PrivilegedActor, src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        isFileExists(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        isDirExists(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        isFile(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        isDir(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        hash(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<string>>>;
    };
    permissions: {
        request(actor: PrivilegedActor, request: PluginPermissionRequest): Promise<RequestStatus<PluginPermissionPromptResult>>;
        revokePlugin(actor: PrivilegedActor, pluginId: string): Promise<RequestStatus<void>>;
    };
    bash: {
        execute(actor: PrivilegedActor, command: string, cwd?: string): Promise<RequestStatus<PrivilegedBashExecuteResult>>;
    };
}

export interface RendererPrivilegedBootstrapInterface extends RendererPrivilegedInterface {
    acquire(): RendererPrivilegedInterface;
    harden(): void;
    isHardened(): boolean;
}

export interface RendererPreloadedInterface {
    // Basic Information
    getPlatform(): Promise<RequestStatus<PlatformInfo>>;
    getAppInfo(): Promise<RequestStatus<AppInfo>>;
    getWindowProps<T extends WindowAppType>(): Promise<RequestStatus<WindowProps[T]>>;
    terminate(err?: string): Promise<void>;

    // Window
    window: {
        ready(): void;
        close(): void;
        closeWith<T extends WindowAppType = WindowAppType>(result: WindowCloseResults[T]): void;
        control: {
            minimize(): Promise<RequestStatus<void>>;
            maximize(): Promise<RequestStatus<void>>;
            unmaximize(): Promise<RequestStatus<void>>;
            close(): Promise<RequestStatus<void>>;
            status(): Promise<RequestStatus<{ status: WindowVisibilityStatus }>>;
            ability(): Promise<RequestStatus<WindowControlAbility>>;
        };
    };

    // File System
    fs: {
        stat(path: string): Promise<RequestStatus<FsRequestResult<FileStat>>>;
        list(path: string): Promise<RequestStatus<FsRequestResult<FileStat[]>>>;
        details(path: string): Promise<RequestStatus<FsRequestResult<FileDetails>>>;
        requestRead(path: string, encoding: BufferEncoding): Promise<RequestStatus<FsRequestResult<string>>>;
        requestReadRaw(path: string): Promise<RequestStatus<FsRequestResult<string>>>;
        requestWrite(path: string, encoding: BufferEncoding): Promise<RequestStatus<FsRequestResult<string>>>;
        requestWriteRaw(path: string): Promise<RequestStatus<FsRequestResult<string>>>;
        ensureRegularFile(path: string, data: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>>;
        writeFileNoFollow(path: string, data: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>>;
        recoverCorruptedJsonFile(path: string, replacement: string, encoding?: BufferEncoding): Promise<RequestStatus<FsRequestResult<void>>>;
        createDir(path: string): Promise<RequestStatus<FsRequestResult<void>>>;
        deleteFile(path: string): Promise<RequestStatus<FsRequestResult<void>>>;
        deleteDir(path: string): Promise<RequestStatus<FsRequestResult<void>>>;
        rename(oldPath: string, newName: string, isDir: boolean): Promise<RequestStatus<FsRequestResult<void>>>;
        copyFile(src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        copyDir(src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        moveFile(src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        moveDir(src: string, dest: string): Promise<RequestStatus<FsRequestResult<void>>>;
        isFileExists(path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        isDirExists(path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        isFile(path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        isDir(path: string): Promise<RequestStatus<FsRequestResult<boolean>>>;
        selectFile(filters: string[], multiple: boolean): Promise<RequestStatus<FsRequestResult<string[]>>>;
        selectDirectory(multiple: boolean): Promise<RequestStatus<FsRequestResult<string[]>>>;
        grantFileAccessForFiles(files: ArrayLike<File>): Promise<RequestStatus<FsRequestResult<string[]>>>;
        hash(path: string): Promise<RequestStatus<FsRequestResult<string>>>;
        getPathForFile(file: File): string;
    };

    selectProjectDirectory(): Promise<RequestStatus<{ dest: string | null }>>;

    // Workspace
    selectFolder(): Promise<RequestStatus<{ path: string | null }>>;
    workspace: {
        launch(props: WindowProps[WindowAppType.Workspace], closeCurrentWindow?: boolean): Promise<RequestStatus<void>>;
        close(): Promise<RequestStatus<void>>;
        getDefaultProjectDirectory(): Promise<RequestStatus<{ dir: string }>>;
        exportProjectPackage(projectPath: string): Promise<RequestStatus<{
            canceled: boolean;
            packagePath?: string;
            fileCount?: number;
            byteLength?: number;
            skippedCount?: number;
        }>>;
        importProjectPackage(): Promise<RequestStatus<{
            canceled: boolean;
            projectPath?: string;
            projectName?: string;
            fileCount?: number;
            byteLength?: number;
        }>>;
        exportConsoleLogs(defaultFileName: string, content: string): Promise<RequestStatus<{
            canceled: boolean;
            filePath?: string;
            byteLength?: number;
        }>>;
        onResolveAssetUrl(handler: (payload: { assetId: string; assetType?: string }) => Promise<RequestStatus<{ url: string }>>): AppEventToken;
        onResolveImageAssetUrl(handler: (payload: { assetId: string }) => Promise<RequestStatus<{ url: string }>>): AppEventToken;
        onBlueprintNavigateFromPreview(handler: (payload: PreviewStudioBlueprintOpenPayload) => void): AppEventToken;
        onMenuAction(handler: (action: WorkspaceMenuAction) => void): AppEventToken;
    };

    // App
    app: {
        launchSettings(props: WindowProps[WindowAppType.Settings]): Promise<RequestStatus<void>>;
        launchProjectWizard(props: WindowProps[WindowAppType.ProjectWizard]): Promise<RequestStatus<{ created: boolean; projectPath: string } | null>>;
        state: {
            getGlobalState<K extends GlobalStateKeys>(key: K): Promise<RequestStatus<{ value: GlobalStateValue<K> }>>;
            setGlobalState<K extends GlobalStateKeys>(key: K, value: GlobalStateValue<K>): Promise<RequestStatus<void>>;
            getAllGlobalState(): Promise<RequestStatus<{ settings: Record<string, any> }>>;
            /** Subscribe to global-state changes broadcast by the main process. */
            onGlobalStateChanged(handler: (change: { key: GlobalStateKeys; value: any }) => void): AppEventToken;
        };
        addRecentProject(name: string, path: string): Promise<RequestStatus<void>>;
        getSystemPath(name: "desktop"): Promise<RequestStatus<{ path: string }>>;
    };

    devMode: {
        launch(projectPath: string, entry: DevModeEntry): Promise<RequestStatus<{ status: DevModeStatus }>>;
        stop(): Promise<RequestStatus<{ status: DevModeStatus }>>;
        reload(): Promise<RequestStatus<{ status: DevModeStatus }>>;
        getStatus(): Promise<RequestStatus<{ status: DevModeStatus }>>;
        onPayloadUpdate(handler: (payload: { bundle: DevModeBundle }) => void): AppEventToken;
        onControlReload(handler: (payload: { revision: number }) => void): AppEventToken;
        onControlError(handler: (payload: { message: string }) => void): AppEventToken;
        onConsoleLog(handler: (payload: DevModeConsoleLogPayload) => void): AppEventToken;
        onBlueprintDebugEvent(handler: (event: BlueprintDebugEvent) => void): AppEventToken;
        forwardBlueprintDebugEvent(payload: DevModeBlueprintDebugEventPayload): void;
        resolveAssetUrl(assetId: string, assetType?: string): Promise<RequestStatus<{ url: string }>>;
        resolveImageAssetUrl(assetId: string): Promise<RequestStatus<{ url: string }>>;
        openBlueprintInWorkspace(
            payload: PreviewStudioBlueprintOpenPayload & { projectPath: string },
        ): Promise<RequestStatus<void>>;
        save: {
            write(
                projectRef: DevModeSaveProjectRef,
                id: string,
                savedGame: unknown,
                capture?: string,
                metadata?: unknown,
            ): Promise<RequestStatus<void>>;
            read(
                projectRef: DevModeSaveProjectRef,
                id: string,
            ): Promise<RequestStatus<{ record: DevModeSaveRecord | null }>>;
            listIds(projectRef: DevModeSaveProjectRef): Promise<RequestStatus<{ ids: string[] }>>;
            readPreview(projectRef: DevModeSaveProjectRef, id: string): Promise<RequestStatus<{ capture: string | null }>>;
            delete(projectRef: DevModeSaveProjectRef, id: string): Promise<RequestStatus<{ deleted: boolean }>>;
        };
    };

    preview: {
        launch(projectPath: string, entry: GameRuntimeLaunchEntry): Promise<RequestStatus<{ status: PreviewStatus }>>;
        stop(projectPath: string): Promise<RequestStatus<{ status: PreviewStatus }>>;
        getStatus(projectPath: string): Promise<RequestStatus<{ status: PreviewStatus }>>;
    };

    gameBuild: {
        start(projectPath: string, entry: GameRuntimeLaunchEntry, request: GameBuildRequest): Promise<RequestStatus<{ state: GameBuildStateSnapshot }>>;
        cancel(projectPath: string): Promise<RequestStatus<{ state: GameBuildStateSnapshot }>>;
        getStatus(projectPath: string): Promise<RequestStatus<{ state: GameBuildStateSnapshot }>>;
        selectOutputDir(defaultPath?: string): Promise<RequestStatus<{ path: string | null }>>;
    };

    blueprintPersistence: {
        getAll(projectRef: BlueprintPersistenceProjectRef): Promise<RequestStatus<{ values: Record<string, unknown> }>>;
        getValue(projectRef: BlueprintPersistenceProjectRef, key: string): Promise<RequestStatus<{ value: unknown }>>;
        setValue(projectRef: BlueprintPersistenceProjectRef, key: string, value: unknown): Promise<RequestStatus<void>>;
        removeValue(projectRef: BlueprintPersistenceProjectRef, key: string): Promise<RequestStatus<void>>;
    };

    pluginPermissions: {
        request(request: PluginPermissionRequest): Promise<RequestStatus<PluginPermissionPromptResult>>;
        grant(
            request: PluginPermissionRequest,
            decision: PluginPermissionDecision,
        ): Promise<RequestStatus<PluginPermissionGrantResult>>;
    };

    plugins: {
        list(): Promise<RequestStatus<{ plugins: PluginListItem[] }>>;
        installLocal(): Promise<RequestStatus<PluginInstallResult>>;
        setEnabled(pluginId: string, enabled: boolean): Promise<RequestStatus<PluginListItem>>;
        approve(pluginId: string): Promise<RequestStatus<PluginApproveResult>>;
        uninstall(pluginId: string): Promise<RequestStatus<void>>;
        revoke(pluginId: string): Promise<RequestStatus<PluginListItem>>;
        getWorkspacePlugins(): Promise<RequestStatus<{ plugins: WorkspacePluginDescriptor[] }>>;
        getRuntimePlugins(): Promise<RequestStatus<{ plugins: RuntimePluginDescriptor[] }>>;
        reportLoadError(pluginId: string, error: string | null): Promise<RequestStatus<PluginListItem>>;
    };

    privileged: RendererPrivilegedBootstrapInterface;
}

declare global {
    interface Window {
        [RendererInterfaceKey]: RendererPreloadedInterface;
    }
}
