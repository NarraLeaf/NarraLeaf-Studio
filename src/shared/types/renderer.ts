import { FileDetails, FileStat, FileEntry, DirectorySizeResult } from "@shared/utils/fs";
import { AppInfo } from "./app";
import { RendererInterfaceKey } from "./constants";
import { BlueprintPersistenceProjectRef, RequestStatus, WorkspaceFreezeKind } from "./ipcEvents";
import type { PsdBakeRequest, PsdBakedLayer, PsdDocument } from "./psdImport";
import { EditMenuRole, MenuActionId, NativeMenuModel } from "./menu";
import { FsRequestResult, PlatformInfo } from "./os";
import type { FsTextEncoding } from "./textEncoding";
import { WindowAppType, WindowProps, WindowVisibilityStatus, WindowControlAbility, WindowCloseResults, WorkspaceViewRequest } from "./window";
import { GlobalStateValue } from "./state/globalState";
import { GlobalStateKeys } from "./state/globalState";
import type { MissingRecentProject } from "./state/appStateTypes";
import { DevModeBlueprintDebugEventPayload, DevModeBundle, DevModeConsoleLogPayload, DevModeEntry, DevModeStatus, DevModeStoryRowHighlight, DevModeStoryRowPayload } from "./devMode";
import type { GameRuntimeLaunchEntry, PreviewStatus } from "./gameRuntime";
import type { BuildPreflightFinding, GameBuildRequest, GameBuildStateSnapshot } from "./gameBuild";
import type {
    MacSigningIdentity,
    SigningCredential,
    SigningCredentialImport,
    SigningInspectResult,
} from "./signing";
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
import type { PuppetRuntimeInstallResult } from "./puppetRuntime";
import type { UITemplateBundle, UITemplateFetchResult } from "./uiTemplateRegistry";
import type {
    PrivilegedActor,
    PrivilegedBashExecuteResult,
} from "./privileged";
import { AppEventToken } from "./app";
import type { LocaleContribution } from "@shared/i18n";
import type { RevisionId, VcsAvailability, VcsCheckpointReason, VcsCommitOptions, VcsCommitResult, VcsHistoryEntry, VcsInitOptions, VcsRepositoryInfo, VcsPushResult, VcsRestoreOptions, VcsRestoreResult, VcsStatus, VcsSyncResult, VcsSyncState, VcsThreeWayResult } from "./vcs";

export interface RendererPrivilegedInterface {
    fs: {
        /** `title` titles the native picker; omitting it keeps the historical default. */
        selectFile(actor: PrivilegedActor, filters: string[], multiple: boolean, title?: string): Promise<RequestStatus<FsRequestResult<string[]>>>;
        /** Native save dialog; resolves to the chosen path, or null when cancelled. */
        selectSaveFile(actor: PrivilegedActor, defaultFileName: string, filters: string[]): Promise<RequestStatus<FsRequestResult<string | null>>>;
        stat(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<FileStat>>>;
        list(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<FileEntry[]>>>;
        details(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<FileDetails>>>;
        requestRead(actor: PrivilegedActor, path: string, encoding: FsTextEncoding): Promise<RequestStatus<FsRequestResult<string>>>;
        requestReadRaw(actor: PrivilegedActor, path: string): Promise<RequestStatus<FsRequestResult<string>>>;
        requestWrite(actor: PrivilegedActor, path: string, encoding: FsTextEncoding): Promise<RequestStatus<FsRequestResult<string>>>;
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
        list(path: string): Promise<RequestStatus<FsRequestResult<FileEntry[]>>>;
        details(path: string): Promise<RequestStatus<FsRequestResult<FileDetails>>>;
        /**
         * Total the bytes of a directory tree in one round trip. Studio-internal (not on the plugin
         * privileged surface): the asset overview reads it instead of walking with per-file IPC, and
         * it shares the build's own measurement - see {@link Fs.directorySize}.
         */
        directorySize(path: string): Promise<RequestStatus<FsRequestResult<DirectorySizeResult>>>;
        requestRead(path: string, encoding: FsTextEncoding): Promise<RequestStatus<FsRequestResult<string>>>;
        requestReadRaw(path: string): Promise<RequestStatus<FsRequestResult<string>>>;
        /**
         * Grant read access to a directory tree, served as `app://fs/{hash}/{relative/path}`.
         * Studio-internal (not on the plugin privileged surface) - see the IPC event's note.
         */
        requestReadDir(path: string): Promise<RequestStatus<FsRequestResult<string>>>;
        requestWrite(path: string, encoding: FsTextEncoding): Promise<RequestStatus<FsRequestResult<string>>>;
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
    /** Pick a PSD through the native dialog and read its layer tree. */
    openPsd(): Promise<RequestStatus<{ filePath: string | null; document: PsdDocument | null }>>;
    /** Bake the chosen layers to full-canvas PNGs. */
    bakePsd(request: PsdBakeRequest): Promise<RequestStatus<{ layers: PsdBakedLayer[] }>>;
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
        /**
         * Write out every pending auto-save and report whether it all landed. Main blocks the close
         * or the quit on the reply, so this must be registered on mount rather than with the
         * workspace context - see the note on `onConfirmClose`.
         */
        onFlushPendingSaves(handler: () => Promise<RequestStatus<{ flushed: boolean }>>): AppEventToken;
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
        /**
         * Tell main whether this workspace's project data is frozen; null means it is writable.
         *
         * Main refuses the production build and Preview while it is - it starts both itself, so the
         * disabled controls in the top bar are affordance, not enforcement. Reported on every change
         * AND once at startup: the renderer's latch is module-level and not persisted, so a window
         * that reloads mid-freeze has to clear what main still believes.
         *
         * `revision` accompanies a `"revision"` freeze, because Dev Mode is not refused - it compiles
         * that revision, and main cannot find it from the kind alone. Omitting it makes main refuse the
         * launch instead of running the working tree.
         */
        reportWriteFreeze(reason: WorkspaceFreezeKind | null, revision?: RevisionId): void;
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
        /**
         * Write a support bundle - `report` plus the environment header and the main-process log
         * tail - to a file the user picks. On the base surface rather than `workspace` so a window
         * whose workspace failed to start can still call it.
         */
        exportDiagnostics(defaultFileName: string, report: string): Promise<RequestStatus<{
            canceled: boolean;
            filePath?: string;
            byteLength?: number;
        }>>;
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
     * Version control. Reads, plus the writes that only ever add a revision:
     * `initRepository`, `commit` and `checkpoint`. None of them can reach a conflict -
     * they extend the author's own branch and never move the working tree - so none
     * waits on a resolve UI. Merge and restore, which do move it, are still absent.
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
        /**
         * Create the repository and commit the working set into it. Fails when the
         * directory already has one. Always the author's explicit act: it writes
         * `.lore/` into their project and takes an exclusive, BLOCKING lock on it.
         */
        initRepository(projectPath: string, options?: VcsInitOptions): Promise<RequestStatus<VcsRepositoryInfo>>;
        /**
         * Working-tree changes since the last commit. On demand only - the scan
         * behind it records newly discovered directories into staged state, so a
         * timer that calls it reports deletions the author never made (§4.17).
         */
        getStatus(projectPath: string): Promise<RequestStatus<VcsStatus>>;
        /**
         * Record the working tree as a new revision: the window's pending saves are
         * flushed, the project is staged, committed, and the backend's stores are
         * forced to disk before this answers. Long; await it and show the failure.
         * "Nothing has changed" is one of those failures, and it is the answer.
         */
        commit(projectPath: string, options?: VcsCommitOptions): Promise<RequestStatus<VcsCommitResult>>;
        /**
         * The same pipeline, labelled a checkpoint. `revision: null` means there was
         * nothing to record - no repository, no backend, or an unchanged tree - which
         * is a success, because an empty revision per interval is not history.
         */
        checkpoint(projectPath: string, reason: VcsCheckpointReason): Promise<RequestStatus<{ revision: VcsCommitResult | null }>>;
        /**
         * Write one revision's content over the working tree and record it as a new revision.
         *
         * The only call on this surface that changes the author's files, and three properties are
         * part of the contract rather than implementation detail:
         *
         *  - a checkpoint is committed BEFORE anything is written, and a failure to take one aborts
         *    the restore rather than proceeding;
         *  - no revision is removed - restoring `#12` onto a project at `#61` produces `#62`, and
         *    `#13`..`#61` are all still there;
         *  - only paths under version control are touched, in either direction. `.nlstudio/`,
         *    `editor/cache`, `dist` and `.lore/` are outside the operation.
         *
         * Long: two commit pipelines plus a rewrite of the whole versioned tree. The caller must
         * leave any revision view and re-read every document once it resolves - the bytes under the
         * editors are no longer the ones they were read from.
         */
        restoreRevision(projectPath: string, revision: RevisionId, options?: VcsRestoreOptions): Promise<RequestStatus<VcsRestoreResult>>;
        /**
         * `includeDetails` costs one call per revision; leave it off unless the details are
         * shown. One call carries `kind`, `message`, `timestamp` and `author` together -
         * which is why the flag is named for all four rather than for the kind alone.
         */
        getHistory(projectPath: string, limit?: number, includeDetails?: boolean): Promise<RequestStatus<{ entries: VcsHistoryEntry[] }>>;
        /** File contents at a revision, base64-encoded. */
        readBlob(projectPath: string, revision: RevisionId, path: string): Promise<RequestStatus<{ contentBase64: string }>>;
        /**
         * Every document at one revision, base64-encoded, in one round trip.
         *
         * `contentBase64: null` means the revision does not contain that path - which is
         * an answer and not a failure: a document added after the revision has to put its
         * editor in the same "missing, use defaults" state as at project open. Omit
         * `paths` to get whatever the revision holds that looks like a document.
         *
         * Batched because the first read of a revision on a project with a remote goes to
         * the network (docs/version-control.md §6). Await it and show progress.
         */
        readRevisionDocuments(projectPath: string, revision: RevisionId, paths?: string[]): Promise<RequestStatus<{ documents: { path: string; contentBase64: string | null }[] }>>;
        getChangedPaths(projectPath: string, from: RevisionId, to: RevisionId): Promise<RequestStatus<{ paths: string[] }>>;
        /** base/mine/theirs for a merge. A missing `base` is an add/add, not an empty file. */
        getThreeWay(projectPath: string, mine: RevisionId, theirs: RevisionId, path: string): Promise<RequestStatus<VcsThreeWayResult>>;
        getMergeBase(projectPath: string, a: RevisionId, b: RevisionId): Promise<RequestStatus<{ base?: RevisionId }>>;
        /**
         * The server this project synchronises with, or null when it has none.
         *
         * A LOCAL read: it reads the repository's own config and opens no socket, so it
         * is safe to ask whenever a panel needs to know which controls to offer. Whether
         * that server can be reached is a different, slower question - `getSyncState`.
         */
        getRemote(projectPath: string): Promise<RequestStatus<{ url: string | null }>>;
        /**
         * Point the project at a server, or disconnect it by passing null.
         *
         * Deliberately does not contact it. Configuring and reaching are separate acts,
         * so this works with the network down and answers immediately.
         */
        setRemote(projectPath: string, url: string | null): Promise<RequestStatus<{ url: string | null }>>;
        /**
         * Where this branch stands against its server.
         *
         * **The one call on this surface that waits on a network**: up to ~2s when
         * nothing answers, which is measured rather than estimated. Only ever call it
         * because someone asked, or right after an operation that changed the answer -
         * never on project open and never on a timer. An unreachable server answers
         * `remoteAvailable: false`; that is information, not an error.
         */
        getSyncState(projectPath: string): Promise<RequestStatus<VcsSyncState>>;
        /**
         * Send this branch's revisions to the server. Writes nothing locally, so a
         * failure leaves the project exactly as it was.
         *
         * A diverged branch fails with the backend's own sentence, which names the
         * remedy: sync first, then push again. `alreadyPushed` is a SUCCESS.
         */
        push(projectPath: string): Promise<RequestStatus<VcsPushResult>>;
        /**
         * Bring the server's revisions down into the working tree.
         *
         * **Changes the author's files**, with the same obligation a restore carries:
         * re-read every document once it resolves, or an editor still holding the
         * pre-sync version will write it back over what arrived.
         *
         * Refused when the working tree is dirty - a sync of a diverged branch merges,
         * and a merge must not land on uncommitted work. `conflicts` non-empty is a
         * SUCCESS that must stop the caller: the tree is already written and Studio has
         * no way to resolve them yet.
         */
        sync(projectPath: string): Promise<RequestStatus<VcsSyncResult>>;
        /**
         * Copy a repository from a server into a local folder, which must be empty or
         * absent. The only call here with no `projectPath`: there is no project at the
         * destination until it finishes.
         */
        clone(url: string, destination: string): Promise<RequestStatus<{ root: string; branch: string; fileCount: number }>>;
    };

    gameBuild: {
        start(projectPath: string, entry: GameRuntimeLaunchEntry, request: GameBuildRequest): Promise<RequestStatus<{ state: GameBuildStateSnapshot }>>;
        cancel(projectPath: string): Promise<RequestStatus<{ state: GameBuildStateSnapshot }>>;
        getStatus(projectPath: string): Promise<RequestStatus<{ state: GameBuildStateSnapshot }>>;
        selectOutputDir(defaultPath?: string): Promise<RequestStatus<{ path: string | null }>>;
        /** Run the build's checks without building; advisory, `start` re-checks. */
        preflight(projectPath: string, request: GameBuildRequest): Promise<RequestStatus<{ findings: BuildPreflightFinding[] }>>;
    };

    /**
     * The machine's code-signing credential vault. Machine-level, not per
     * project: a project only ever stores a credential id, so opening it
     * elsewhere leaves the id dangling until the same credential is imported
     * there.
     *
     * No call returns a password. `import` is the one direction a secret
     * travels - up, once, straight into the OS keyring.
     */
    signing: {
        /** Redacted credentials: metadata only. */
        list(): Promise<RequestStatus<{ credentials: SigningCredential[] }>>;
        /**
         * File fields are absolute paths the author picked; the vault copies each
         * one in. Secret fields are plain text - do not log the payload or hold
         * it after the call resolves.
         */
        import(input: SigningCredentialImport): Promise<RequestStatus<{ credential: SigningCredential }>>;
        remove(id: string): Promise<RequestStatus<{ removed: boolean }>>;
        /** Certificate subject / issuer / validity / thumbprint, for display. */
        inspect(id: string): Promise<RequestStatus<SigningInspectResult>>;
        /**
         * The signing keys inside a keystore the author has picked but not
         * imported yet, so the import form can offer them. `storePassword` is
         * plain text and travels the same one way `import` does.
         */
        keystoreAliases(file: string, storePassword: string): Promise<RequestStatus<{ aliases: string[] }>>;
        /**
         * The code-signing identities in this Mac's keychains, so the import form
         * can offer them rather than asking for a certificate name typed out by
         * hand. Empty on every other host. Names certificates only - no key
         * material is read.
         */
        macIdentities(): Promise<RequestStatus<{ identities: MacSigningIdentity[] }>>;
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
        /** A store thumbnail as a `data:` URL, fetched and cached by main. Null when there is none. */
        registryIcon(pluginId: string): Promise<RequestStatus<{ icon: string | null }>>;
        installFromRegistry(pluginId: string): Promise<RequestStatus<PluginInstallResult>>;
    };

    uiTemplates: {
        registryFetch(): Promise<RequestStatus<UITemplateFetchResult>>;
        fetchBundle(templateId: string): Promise<RequestStatus<UITemplateBundle>>;
    };

    /**
     * Author-supplied 2D model runtimes. Studio-internal and deliberately *not* on the plugin facade:
     * this writes a megabyte of generated code into the project, and a plugin has no business asking
     * for that.
     */
    puppetRuntimes: {
        /**
         * Compile a named runtime from the SDK archive at `archivePath` into the project.
         *
         * Only for runtimes whose registry entry offers `sdk-zip`; the host refuses the rest. There is
         * no matching verb for a prebuilt adapter — that is a directory copy plus a trial load, both of
         * which the renderer can already do (see `installPrebuiltPuppetRuntime`).
         */
        installSdk(
            runtimeId: string,
            projectPath: string,
            archivePath: string,
        ): Promise<RequestStatus<PuppetRuntimeInstallResult>>;
    };

    privileged: RendererPrivilegedBootstrapInterface;
}

declare global {
    interface Window {
        [RendererInterfaceKey]: RendererPreloadedInterface;
    }
}
