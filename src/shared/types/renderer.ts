import { FileDetails, FileStat } from "@shared/utils/fs";
import { AppInfo } from "./app";
import { RendererInterfaceKey } from "./constants";
import { BlueprintPersistenceProjectRef, RequestStatus } from "./ipcEvents";
import { EditMenuRole, MenuActionId, NativeMenuModel } from "./menu";
import { FsRequestResult, PlatformInfo } from "./os";
import { WindowAppType, WindowProps, WindowVisibilityStatus, WindowControlAbility, WindowCloseResults, WorkspaceViewRequest } from "./window";
import { GlobalStateValue } from "./state/globalState";
import { GlobalStateKeys } from "./state/globalState";
import type { MissingRecentProject } from "./state/appStateTypes";
import { DevModeBlueprintDebugEventPayload, DevModeBundle, DevModeConsoleLogPayload, DevModeEntry, DevModeStatus, DevModeStoryRowHighlight, DevModeStoryRowPayload } from "./devMode";
import type { GameRuntimeLaunchEntry, PreviewStatus } from "./gameRuntime";
import type { BuildPreflightFinding, GameBuildRequest, GameBuildStateSnapshot } from "./gameBuild";
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
import type { PluginRegistryFetchResult } from "./pluginRegistry";
import type {
    PrivilegedActor,
    PrivilegedBashExecuteResult,
} from "./privileged";
import { AppEventToken } from "./app";
import type { LocaleContribution } from "@shared/i18n";
import type { RevisionId, VcsAvailability, VcsHistoryEntry, VcsRepositoryInfo, VcsThreeWayResult } from "./vcs";

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
        editCommand(command: EditMenuRole): void;
        control: {
            minimize(): Promise<RequestStatus<void>>;
            maximize(): Promise<RequestStatus<void>>;
            unmaximize(): Promise<RequestStatus<void>>;
            close(): Promise<RequestStatus<void>>;
            status(): Promise<RequestStatus<{ status: WindowVisibilityStatus }>>;
            ability(): Promise<RequestStatus<WindowControlAbility>>;
            /** Current fullscreen state of this window (macOS hides the traffic lights in fullscreen). */
            getFullscreen(): Promise<RequestStatus<{ isFullscreen: boolean }>>;
            onFullscreenChanged(handler: (payload: { isFullscreen: boolean }) => void): AppEventToken;
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
        /**
         * Open a recent project by path, focusing an already-open window instead of duplicating it.
         * With `replaceCurrentWindow`, the calling window is closed once the target opens - a
         * "switch in this window" rather than opening alongside.
         */
        openRecent(projectPath: string, replaceCurrentWindow?: boolean): Promise<RequestStatus<void>>;
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
        onConfirmClose(handler: () => Promise<RequestStatus<{ confirmed: boolean }>>): AppEventToken;
        onResolveAssetUrl(handler: (payload: { assetId: string; assetType?: string }) => Promise<RequestStatus<{ url: string }>>): AppEventToken;
        onResolveImageAssetUrl(handler: (payload: { assetId: string }) => Promise<RequestStatus<{ url: string }>>): AppEventToken;
        onBlueprintNavigateFromPreview(handler: (payload: PreviewStudioBlueprintOpenPayload) => void): AppEventToken;
        onMenuAction(handler: (action: MenuActionId) => void): AppEventToken;
        syncNativeMenu(model: NativeMenuModel): void;
        /**
         * Tell the main process whether this workspace actually loaded its project. Replace-style
         * launches (`closeCurrentWindow`/`replaceOpener`) only retire the opener on `ok: true` -
         * a window showing the "not a project" screen must not have consumed the window it came from.
         */
        reportLoadResult(ok: boolean): void;
        /** Main asking this workspace to reveal a surface on the Settings window's behalf. */
        onOpenViewRequest(handler: (view: WorkspaceViewRequest) => void): AppEventToken;
    };

    // App
    app: {
        /**
         * Open the Settings window, or focus the one already open. `props.highlight` names a
         * setting (or category) key to reveal; an existing window is told about it through
         * {@link onSettingsHighlight} rather than a second window being stacked on top.
         */
        launchSettings(props: WindowProps[WindowAppType.Settings]): Promise<RequestStatus<void>>;
        /** Settings window only: another window asked this one to reveal a setting. */
        onSettingsHighlight(handler: (highlight: string) => void): AppEventToken;
        /** Open workspace-window count - gates settings actions that need a workspace to act in. */
        countWorkspaceWindows(): Promise<RequestStatus<{ count: number }>>;
        /**
         * Ask one workspace window (the focused one, else the first) to reveal a surface that only
         * exists there. `delivered: false` means no workspace was open to receive it.
         */
        requestWorkspaceView(view: WorkspaceViewRequest): Promise<RequestStatus<{ delivered: boolean }>>;
        /** Open an http(s) URL in the system browser (other schemes are refused). */
        openExternal(url: string): Promise<RequestStatus<void>>;
        /** Pick + store a custom background image; returns the stored filename (null = cancelled). */
        pickBackgroundImage(): Promise<RequestStatus<{ file: string | null }>>;
        /** Read a stored background image's bytes (basename lookup only). */
        readBackgroundImage(file: string): Promise<RequestStatus<{ data: Uint8Array | null }>>;
        launchProjectWizard(props: WindowProps[WindowAppType.ProjectWizard]): Promise<RequestStatus<{ created: boolean; projectPath: string } | null>>;
        state: {
            getGlobalState<K extends GlobalStateKeys>(key: K): Promise<RequestStatus<{ value: GlobalStateValue<K> }>>;
            setGlobalState<K extends GlobalStateKeys>(key: K, value: GlobalStateValue<K>): Promise<RequestStatus<void>>;
            getAllGlobalState(): Promise<RequestStatus<{ settings: Record<string, any> }>>;
            /** Subscribe to global-state changes broadcast by the main process. */
            onGlobalStateChanged(handler: (change: { key: GlobalStateKeys; value: any }) => void): AppEventToken;
        };
        addRecentProject(name: string, path: string): Promise<RequestStatus<void>>;
        /** Removes by path; the main process owns the read-modify-write. */
        removeRecentProject(path: string): Promise<RequestStatus<void>>;
        /** Which remembered projects are no longer on disk. Reports only; removes nothing. */
        checkRecentProjects(): Promise<RequestStatus<{ missing: MissingRecentProject[] }>>;
        getSystemPath(name: "desktop" | "home"): Promise<RequestStatus<{ path: string }>>;
    };

    devMode: {
        launch(projectPath: string, entry: DevModeEntry): Promise<RequestStatus<{ status: DevModeStatus }>>;
        /** Dev Mode is per-project; these name the project rather than acting on "whatever runs". */
        stop(projectPath: string): Promise<RequestStatus<{ status: DevModeStatus }>>;
        reload(projectPath: string): Promise<RequestStatus<{ status: DevModeStatus }>>;
        getStatus(projectPath: string): Promise<RequestStatus<{ status: DevModeStatus }>>;
        /** Fullscreen state of the Dev Mode window itself. */
        getFullscreen(): Promise<RequestStatus<{ isFullscreen: boolean }>>;
        setFullscreen(fullscreen: boolean): Promise<RequestStatus<void>>;
        onFullscreenChanged(handler: (payload: { isFullscreen: boolean }) => void): AppEventToken;
        onCloseRequested(handler: () => Promise<RequestStatus<{ allow: boolean }>>): AppEventToken;
        onPayloadUpdate(handler: (payload: { bundle: DevModeBundle }) => void): AppEventToken;
        onControlReload(handler: (payload: { revision: number }) => void): AppEventToken;
        onControlError(handler: (payload: { message: string }) => void): AppEventToken;
        onConsoleLog(handler: (payload: DevModeConsoleLogPayload) => void): AppEventToken;
        onBlueprintDebugEvent(handler: (event: BlueprintDebugEvent) => void): AppEventToken;
        forwardBlueprintDebugEvent(payload: DevModeBlueprintDebugEventPayload): void;
        forwardStoryRow(payload: DevModeStoryRowPayload): void;
        onStoryRowHighlight(handler: (payload: DevModeStoryRowHighlight) => void): AppEventToken;
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

    /**
     * Version control. Read-only until the resolve UI lands.
     * Every call is per project - Studio is one-project-one-window and the VCS
     * runtime is keyed by project path.
     */
    vcs: {
        /**
         * Ask first. Version control is optional - no native build exists for
         * macOS Intel or Windows ARM64 - and every other call below fails on a
         * host without one. Branch the UI on this; do not probe with try/catch.
         */
        getAvailability(): Promise<RequestStatus<VcsAvailability>>;
        isRepository(projectPath: string): Promise<RequestStatus<{ isRepository: boolean }>>;
        getInfo(projectPath: string): Promise<RequestStatus<VcsRepositoryInfo>>;
        getHistory(projectPath: string, limit?: number): Promise<RequestStatus<{ entries: VcsHistoryEntry[] }>>;
        /** File contents at a revision, base64-encoded. */
        readBlob(projectPath: string, revision: RevisionId, path: string): Promise<RequestStatus<{ contentBase64: string }>>;
        getChangedPaths(projectPath: string, from: RevisionId, to: RevisionId): Promise<RequestStatus<{ paths: string[] }>>;
        /** base/mine/theirs for a merge. A missing `base` is an add/add, not an empty file. */
        getThreeWay(projectPath: string, mine: RevisionId, theirs: RevisionId, path: string): Promise<RequestStatus<VcsThreeWayResult>>;
        getMergeBase(projectPath: string, a: RevisionId, b: RevisionId): Promise<RequestStatus<{ base?: RevisionId }>>;
    };

    gameBuild: {
        start(projectPath: string, entry: GameRuntimeLaunchEntry, request: GameBuildRequest): Promise<RequestStatus<{ state: GameBuildStateSnapshot }>>;
        cancel(projectPath: string): Promise<RequestStatus<{ state: GameBuildStateSnapshot }>>;
        getStatus(projectPath: string): Promise<RequestStatus<{ state: GameBuildStateSnapshot }>>;
        selectOutputDir(defaultPath?: string): Promise<RequestStatus<{ path: string | null }>>;
        /** Run the build's checks without building; advisory, `start` re-checks. */
        preflight(projectPath: string, request: GameBuildRequest): Promise<RequestStatus<{ findings: BuildPreflightFinding[] }>>;
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
        getLocaleContributions(): Promise<RequestStatus<{ contributions: LocaleContribution[] }>>;
        onLocalesChanged(handler: (change: { version: number }) => void): AppEventToken;
        registryFetch(): Promise<RequestStatus<PluginRegistryFetchResult>>;
        installFromRegistry(pluginId: string): Promise<RequestStatus<PluginInstallResult>>;
    };

    privileged: RendererPrivilegedBootstrapInterface;
}

declare global {
    interface Window {
        [RendererInterfaceKey]: RendererPreloadedInterface;
    }
}
