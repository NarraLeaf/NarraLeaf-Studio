import { FileDetails, FileStat, FileEntry, DirectorySizeResult } from "@shared/utils/fs";
import { AppInfo } from "./app";
import { RendererInterfaceKey } from "./constants";
import { BlueprintPersistenceProjectRef, RendererErrorReport, RequestStatus, WorkspaceCloseStage, WorkspaceFreezeKind } from "./ipcEvents";
import type { BlueprintNetworkFetchRequest, BlueprintNetworkFetchResult } from "./blueprint/network";
import type { BlueprintPointerMoveRequest, BlueprintPointerMoveResult } from "./blueprint/pointer";
import type { BlueprintOpenExternalRequest, BlueprintOpenExternalResult } from "./blueprint/externalLink";
import type {
    GameProgressExportRequest,
    GameProgressExportResult,
    GameProgressImportResult,
} from "./gameProgress";
import type { MediaConvertRequest, MediaConvertStateSnapshot } from "./mediaConvert";
import type { MediaProbeOutcome } from "./mediaProbe";
import type { PsdBakeRequest, PsdBakedLayer, PsdDocument } from "./psdImport";
import { EditMenuRole, MenuActionId, NativeMenuModel } from "./menu";
import { FsRequestResult, PlatformInfo } from "./os";
import type { FsTextEncoding } from "./textEncoding";
import { WindowAppType, WindowProps, WindowVisibilityStatus, WindowControlAbility, WindowCloseResults, WorkspaceViewRequest } from "./window";
import { GlobalStateValue } from "./state/globalState";
import { GlobalStateKeys } from "./state/globalState";
import type { MissingRecentProject } from "./state/appStateTypes";
import { DevModeBlueprintDebugEventPayload, DevModeBundle, DevModeConsoleLogPayload, DevModeEntry, DevModeStatus, DevModeStoryRowHighlight, DevModeStoryRowOpenPayload, DevModeStoryRowOpenRequest, DevModeStoryRowPayload } from "./devMode";
import type { GameRuntimeLaunchEntry, PreviewStatus } from "./gameRuntime";
import type { GameTestEventPayload, GameTestLaunchRequest, GameTestLaunchResult } from "./gameTest";
import type { BuildPreflightFinding, GameBuildRequest, GameBuildStateSnapshot } from "./gameBuild";
import type {
    MacSigningIdentity,
    SigningCredential,
    SigningCredentialImport,
    SigningInspectResult,
} from "./signing";
import type { BlueprintDebugEvent } from "./blueprint/debug";
import type { ServerTrustPromptProps } from "./serverTrust";
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
import type { CacheClearResult, CacheInventoryReport } from "./cacheInventory";
import type { UpdateState } from "@shared/constants/update";
import type { PluginRegistryFetchResult } from "./pluginRegistry";
import type { PuppetRuntimeInstallResult } from "./puppetRuntime";
import type { UITemplateBundle, UITemplateFetchResult, UITemplatePreview, UIThemePreview } from "./uiTemplateRegistry";
import type { ProjectTemplateDescriptor } from "./projectTemplate";
import type { RemoteAssetFetchResult, RemoteAssetValidators } from "./remoteAsset";
import type { AssetExportEntry, AssetExportResult } from "./assetExport";
import type {
    AvailableSpellcheckDictionary,
    InstalledSpellcheckDictionary,
    SpellcheckRange,
    SpellcheckStatus,
} from "./spellcheck";
import type {
    PrivilegedActor,
    PrivilegedBashExecuteResult,
} from "./privileged";
import { AppEventToken } from "./app";
import type { LocaleContribution } from "@shared/i18n";
import type { VcsServerProbe } from "./vcs";
import type { RevisionId, VcsAddServerOutcome, VcsAvailability, VcsCheckpointReason, VcsCommitOptions, VcsCommitResult, VcsConflictChoice, VcsHistoryEntry, VcsInitOptions, VcsMergeCompletion, VcsMergeDecision, VcsMergeDocument, VcsMergeResolveResult, VcsMergeState, VcsRepositoryInfo, VcsPushResult, VcsRestoreOptions, VcsRestoreResult, VcsRevisionDiffResult, VcsServerProjectOutcome, VcsServerProjectsOutcome, VcsServerSession, VcsSignInOutcome, VcsStatus, VcsSyncResult, VcsSyncState, VcsThreeWayResult, VcsWorkingFileRead, VcsWorkingTreeDiffResult } from "./vcs";

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
    /**
     * Record a renderer failure in the main-process log, which outlives this window.
     *
     * Reporting only. Nothing about what the window does next is decided here - that is the
     * caller's business, and most callers keep running.
     */
    reportError(report: RendererErrorReport): void;

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
        /**
         * The same controls, for a window this one detached part of itself into (see
         * `detachedWindowGuard` in the main process). Named rather than implicit: a detached popup
         * sends IPC through its opener, so `control.close()` from the buttons drawn in that popup
         * would close the window it was detached FROM.
         */
        detachedControl(
            key: string,
            control: "status" | "minimize" | "toggleMaximize" | "close",
        ): Promise<RequestStatus<{ status: WindowVisibilityStatus }>>;
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
    /** Pick the `.nlspkg` an import unpacks; the chosen file becomes readable to this window. */
    selectProjectPackage(): Promise<RequestStatus<{ dest: string | null }>>;

    // Workspace
    selectFolder(): Promise<RequestStatus<{ path: string | null }>>;
    /** Pick a PSD through the native dialog and read its layer tree. */
    openPsd(): Promise<RequestStatus<{ filePath: string | null; document: PsdDocument | null }>>;
    /** Bake the chosen layers to full-canvas PNGs. */
    bakePsd(request: PsdBakeRequest): Promise<RequestStatus<{ layers: PsdBakedLayer[] }>>;
    /**
     * What is inside a media file, and whether the engine can play it as it stands.
     *
     * Read-only: it runs ffprobe and returns a verdict. Converting anything is a separate,
     * explicit step.
     */
    probeMedia(path: string): Promise<RequestStatus<{ outcome: MediaProbeOutcome }>>;
    /**
     * Converting a media file, polled the way a production build is.
     *
     * `start` answers with a job id as soon as the process is up; `getStatus` carries progress while
     * it runs and the outcome once it stops; `cancel` stops it and removes the partial file. A job
     * id that means nothing here answers `idle`, which is also what a job answers once it has aged
     * out of the main process's memory.
     */
    mediaConvert: {
        start(request: MediaConvertRequest): Promise<RequestStatus<{ state: MediaConvertStateSnapshot }>>;
        cancel(jobId: string): Promise<RequestStatus<{ state: MediaConvertStateSnapshot }>>;
        getStatus(jobId: string): Promise<RequestStatus<{ state: MediaConvertStateSnapshot }>>;
    };
    workspace: {
        launch(props: WindowProps[WindowAppType.Workspace], closeCurrentWindow?: boolean): Promise<RequestStatus<void>>;
        /**
         * Open a recent project by path, focusing an already-open window instead of duplicating it.
         * With `replaceCurrentWindow`, the calling window is closed once the target opens - a
         * "switch in this window" rather than opening alongside.
         */
        openRecent(projectPath: string, replaceCurrentWindow?: boolean): Promise<RequestStatus<void>>;
        /**
         * Whether this project already has a window. Opening it would focus that window rather than
         * open anything, so a surface that asks the author which window to use asks this first and
         * skips the question when the answer is yes.
         */
        isProjectOpen(projectPath: string): Promise<RequestStatus<{ open: boolean }>>;
        close(): Promise<RequestStatus<void>>;
        getDefaultProjectDirectory(): Promise<RequestStatus<{ dir: string }>>;
        exportProjectPackage(projectPath: string): Promise<RequestStatus<{
            canceled: boolean;
            packagePath?: string;
            fileCount?: number;
            byteLength?: number;
            skippedCount?: number;
        }>>;
        importProjectPackage(packagePath: string, targetDir: string): Promise<RequestStatus<{
            projectPath: string;
            projectName?: string;
            fileCount?: number;
            byteLength?: number;
        }>>;
        exportConsoleLogs(defaultFileName: string, content: string): Promise<RequestStatus<{
            canceled: boolean;
            filePath?: string;
            byteLength?: number;
        }>>;
        /**
         * Reopen this window as a recovery shell (`true`) or as an ordinary workspace (`false`).
         *
         * Reloads the window, so the caller does not outlive the call. Nothing is flushed on the way
         * in - see the handler - which is why the surface offering this has to ask the author first
         * when the workspace actually came up.
         */
        setRecoveryMode(enabled: boolean, reason?: string): Promise<RequestStatus<void>>;
        /** Reveal this window's project folder in the OS file manager. */
        openProjectFolder(): Promise<RequestStatus<void>>;
        onConfirmClose(handler: () => Promise<RequestStatus<{ confirmed: boolean }>>): AppEventToken;
        /**
         * Write out every pending auto-save and report whether it all landed. Main blocks the close
         * or the quit on the reply, so this must be registered on mount rather than with the
         * workspace context - see the note on `onConfirmClose`.
         */
        onFlushPendingSaves(handler: () => Promise<RequestStatus<{ flushed: boolean }>>): AppEventToken;
        /**
         * Follow the close the main process is running on this window's behalf, so the workspace
         * can show what it is waiting on. `null` means the close was called off and the window is
         * staying. Registered on mount for the same reason as the two handlers above.
         */
        onCloseProgress(handler: (stage: WorkspaceCloseStage | null) => void): AppEventToken;
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
        /**
         * Studio's own spellchecker, which runs in the main process.
         *
         * It is here rather than in the renderer for two reasons that both hold whatever the
         * renderer does about them. The dictionaries are downloaded, and every remote byte in this
         * app goes through main. And the checking itself needs a thread the renderer does not have:
         * the window document is `file://` while its scripts are `app://`, so no Web Worker can be
         * started, and a scene checked on every keystroke on the renderer's own thread is a stutter
         * the author feels.
         *
         * The project dictionary is a document the workspace owns; {@link configure} is only how its
         * words reach the checker.
         */
        spellcheck: {
            /** Tell the checker about this project: the language of its script, and the words it keeps. */
            configure(sourceLocale: string, words: string[]): Promise<RequestStatus<SpellcheckStatus>>;
            /** Forget this window's project words, so the next project does not inherit them. */
            clear(): Promise<RequestStatus<void>>;
            /** What spellchecking is doing now, including every language a dictionary is installed for. */
            getStatus(): Promise<RequestStatus<SpellcheckStatus>>;
            /**
             * The misspellings in one run of plain text. `start`/`end` are offsets into `text`; the
             * caller maps them back onto whatever it built the string from.
             */
            check(text: string, language: string): Promise<RequestStatus<{ ranges: SpellcheckRange[] }>>;
            /** Replacements for one misspelling, nearest first, at most five. */
            suggest(word: string, language: string): Promise<RequestStatus<{ suggestions: string[] }>>;
            /** The dictionaries on this machine. No network. */
            listInstalled(): Promise<RequestStatus<{ languages: InstalledSpellcheckDictionary[] }>>;
            /** The dictionaries the registry offers, with their licences. Goes to the network. */
            listAvailable(): Promise<RequestStatus<{ entries: AvailableSpellcheckDictionary[] }>>;
            /** Fetch one dictionary into the cache. Author-initiated, and sha256-verified. */
            download(code: string): Promise<RequestStatus<{ ok: boolean }>>;
            /** Delete one dictionary from the cache. */
            remove(code: string): Promise<RequestStatus<{ ok: boolean }>>;
        };
        /** Pick + store a custom background image; returns the stored filename (null = cancelled). */
        pickBackgroundImage(): Promise<RequestStatus<{ file: string | null }>>;
        /** Read a stored background image's bytes (basename lookup only). */
        readBackgroundImage(file: string): Promise<RequestStatus<{ data: Uint8Array | null }>>;
        launchProjectWizard(props: WindowProps[WindowAppType.ProjectWizard]): Promise<RequestStatus<{ created: boolean; projectPath: string } | null>>;
        /**
         * Ask the author whether a server is trusted, and answer with what the machine
         * believes afterwards.
         *
         * On `app` rather than `vcs` because it needs no project: the window opens over
         * Settings and over a workspace alike, and trust belongs to the account. Resolves
         * once the window is gone; a window closed without an answer resolves `false`.
         */
        promptServerTrust(props: ServerTrustPromptProps): Promise<RequestStatus<{ trusted: boolean }>>;
        state: {
            getGlobalState<K extends GlobalStateKeys>(key: K): Promise<RequestStatus<{ value: GlobalStateValue<K> }>>;
            setGlobalState<K extends GlobalStateKeys>(key: K, value: GlobalStateValue<K>): Promise<RequestStatus<void>>;
            getAllGlobalState(): Promise<RequestStatus<{ settings: Record<string, any> }>>;
            /**
             * Remove stored values so the next read resolves the default. Not the same as writing
             * the default: several keys resolve a fallback only when nothing is stored at all.
             * Keys that are not preferences (the project history, per-project statistics) are
             * refused by the host and come back under `refused`.
             */
            deleteGlobalState(keys: string[]): Promise<RequestStatus<{ deleted: string[]; refused: string[] }>>;
            /**
             * Subscribe to global-state changes broadcast by the main process. A delete arrives
             * as a change whose `value` is undefined - resolve it through the setting's default
             * rather than storing it.
             */
            onGlobalStateChanged(handler: (change: { key: GlobalStateKeys; value: any }) => void): AppEventToken;
        };
        addRecentProject(name: string, path: string): Promise<RequestStatus<void>>;
        /** Removes by path; the main process owns the read-modify-write. */
        removeRecentProject(path: string): Promise<RequestStatus<void>>;
        /** Shows a remembered project's folder in the OS file manager. Paths outside the history are refused. */
        revealRecentProject(path: string): Promise<RequestStatus<void>>;
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
        /**
         * Whether a download mirror answers. In the host because the renderer never opens a
         * network connection of its own, a URL the user just typed included.
         */
        probeDownloadSource(url: string): Promise<RequestStatus<{
            reachable: boolean;
            status?: number;
            error?: string;
        }>>;
        /** Sizes of the caches Studio can throw away. Measured on demand, so this is not instant. */
        getCacheInventory(): Promise<RequestStatus<CacheInventoryReport>>;
        /** Empty the named buckets; ids this build does not know come back under `failed`. */
        clearCaches(ids: string[]): Promise<RequestStatus<CacheClearResult>>;
        /** Write a settings document to a file the user picks. */
        exportSettings(defaultFileName: string, content: string): Promise<RequestStatus<{
            canceled: boolean;
            filePath?: string;
        }>>;
        /** Read a settings document the user picks; parsing happens in the renderer. */
        importSettings(): Promise<RequestStatus<{
            canceled: boolean;
            filePath?: string;
            content?: string;
        }>>;
        /**
         * Software updates. The renderer only ever *asks* - what an update is, whether one can be
         * installed on this host, and how far a download has got are all decided in main
         * (`UpdateManager`) and pushed through `onStateChanged`.
         */
        update: {
            /** One snapshot, for a surface that just mounted. Changes arrive on `onStateChanged`. */
            getState(): Promise<RequestStatus<{ state: UpdateState }>>;
            /** Ask whether a newer release exists. Never starts a download. */
            check(): Promise<RequestStatus<{ state: UpdateState }>>;
            /** Start the transfer. Only the Settings panel calls this - see its header for why. */
            download(): Promise<RequestStatus<{ state: UpdateState }>>;
            /** Quit and apply what was downloaded. */
            install(): Promise<RequestStatus<void>>;
            onStateChanged(handler: (state: UpdateState) => void): AppEventToken;
        };
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
        /**
         * Open a story row in the workspace and bring that window forward. Unlike `forwardStoryRow`
         * this is a deliberate navigation — it opens the scene editor if it is not already open — so
         * it is only ever called from something the author clicked.
         */
        openStoryRowInWorkspace(payload: DevModeStoryRowOpenPayload): Promise<RequestStatus<void>>;
        /** Workspace side of {@link openStoryRowInWorkspace}. */
        onStoryRowOpen(handler: (payload: DevModeStoryRowOpenRequest) => void): AppEventToken;
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
     * Game processes owned by a test run.
     *
     * No `getStatus`: everything a test needs to know arrives on `onEvent`, in order. A polled
     * status could not distinguish the two exits a test cares about, which is the reason this
     * namespace exists next to `preview` rather than inside it.
     */
    gameTest: {
        launch(request: GameTestLaunchRequest): Promise<RequestStatus<GameTestLaunchResult>>;
        stop(projectPath: string, sessionId: string): Promise<RequestStatus<void>>;
        onEvent(handler: (payload: GameTestEventPayload) => void): AppEventToken;
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
         * The same file as the working tree holds it now, base64-encoded.
         *
         * The comparison's other side, and narrow by design: one repository-relative path, under
         * version control, under a size ceiling. `refusal: "tooLarge"` with no content is an
         * answer about a file that is really there. A path outside the project or outside version
         * control is a failure instead, because no comparison can name one.
         */
        readWorkingFile(projectPath: string, path: string): Promise<RequestStatus<VcsWorkingFileRead>>;
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
        /**
         * What changed between two revisions, as changes rather than as bytes.
         *
         * Answered from a cache in the main process when the same pair was asked before, which is
         * sound because revisions are immutable. Read `tier` on every diff before deciding how to
         * draw it: a `structural` diff is the JSON paths whose values differ, with nothing in the
         * picture that knows what they mean, and drawing it like a `semantic` one tells the author
         * a generated id changing is a change they made. `complete: false` and `readFailure` both
         * have to be shown - the first is a truncated list, the second is an empty one that means
         * the opposite of "nothing changed".
         */
        diffRevisions(projectPath: string, from: RevisionId, to: RevisionId): Promise<RequestStatus<VcsRevisionDiffResult>>;
        /**
         * What the author has changed since the last version.
         *
         * **Never cache the result, and never poll this.** The working tree has already moved on by
         * the time it resolves, and the status read underneath scans - a scan that finds a new
         * directory records it into staged state, so polling manufactures deletions of things that
         * never existed (docs/version-control.md §4.17).
         */
        diffWorkingTree(projectPath: string): Promise<RequestStatus<VcsWorkingTreeDiffResult>>;
        /** base/mine/theirs for a merge. A missing `base` is an add/add, not an empty file. */
        getThreeWay(projectPath: string, mine: RevisionId, theirs: RevisionId, path: string): Promise<RequestStatus<VcsThreeWayResult>>;
        getMergeBase(projectPath: string, a: RevisionId, b: RevisionId): Promise<RequestStatus<{ base?: RevisionId }>>;
        /**
         * Whether this project is in the middle of a merge, and which paths are still open.
         *
         * **Ask on project open, not only after a sync.** A merge lives in the repository
         * and outlives the window: an author who closes Studio on a conflicted sync reopens
         * onto the same unfinished merge, and nothing in memory remembers it. Cheap and
         * local - a non-scanning status read plus a walk of the versioned working set.
         *
         * `conflicts` is empty for a merge with nothing left to decide, which is NOT the
         * same as `inProgress: false` - the merge is open until it is committed or
         * abandoned.
         */
        getMergeState(projectPath: string): Promise<RequestStatus<VcsMergeState>>;
        /**
         * Tier two: the three-way merge of ONE conflicted document, change by change.
         *
         * Built from the three copies the merge left beside the file, so it needs no revision
         * graph and no base lookup. Records nothing and remembers nothing - the choices taken on
         * it live in the window that asked, exactly as the whole-file ones do.
         *
         * **`blocked` is a normal answer and must be drawn.** Most paths have no spec, most specs
         * have no three-way merge yet, and one that has one may still refuse to write itself back;
         * all three keep the path at tier one, and hiding the row would make "Studio cannot do
         * this here" indistinguishable from "there is nothing left to decide here".
         */
        getMergeDocument(projectPath: string, path: string): Promise<RequestStatus<VcsMergeDocument>>;
        /**
         * Settle conflicted paths by taking one side, or by taking the working tree as it is.
         *
         * **Records nothing.** Settling is not committing: the merge stays open until
         * `commit` closes it, which is what lets the author decide one file, look, and then
         * decide the next.
         *
         * `mine` and `theirs` OVERWRITE the working tree for those paths, so re-read every
         * document named - an editor still holding the pre-merge bytes writes them straight
         * back over the side the author just chose. `working-tree` writes nothing and
         * accepts the bytes on disk verbatim, which is how an answer neither side wrote
         * gets settled: write the file first, then call this.
         */
        resolveConflicts(projectPath: string, paths: string[], choice: VcsConflictChoice): Promise<RequestStatus<VcsMergeResolveResult>>;
        /**
         * Take one side per path and close the merge with a commit.
         *
         * The whole of "take one side, whole", as ONE operation: settling and recording are a
         * single queued act so that nothing - notably the checkpoint timer - can commit the
         * author's merge in between under its own message and kind.
         *
         * **This writes the author's files** (each side overwrites its path) and then records a
         * revision, so the caller carries a restore's obligations: hold the workspace in its
         * view, release before leaving it, and re-read every document once it resolves.
         *
         * A path left out of `decisions` that the merge has not settled makes the commit fail
         * with the backend's own sentence, which names the path.
         */
        completeMerge(projectPath: string, decisions: VcsMergeDecision[], options?: VcsCommitOptions): Promise<RequestStatus<VcsMergeCompletion>>;
        /** Undo a choice. All three sides are still on disk, so it costs nothing. */
        unresolveConflicts(projectPath: string, paths: string[]): Promise<RequestStatus<VcsMergeResolveResult>>;
        /**
         * Merge these paths again from scratch, DISCARDING the working-tree bytes for them.
         *
         * Unresolving takes a decision back; this throws the edits away as well. Re-read
         * every path named.
         */
        restartConflicts(projectPath: string, paths: string[]): Promise<RequestStatus<VcsMergeState>>;
        /**
         * Abandon the merge and put the working tree back to before it started.
         *
         * A COMPLETE rollback - measured, not hoped for: every file back to its pre-merge
         * content and the merge's leftovers deleted. It writes the author's files, so
         * re-read every document once it resolves.
         */
        abortMerge(projectPath: string): Promise<RequestStatus<VcsMergeState>>;
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
         * Who this installation is signed in to this project's server as, or null.
         *
         * A LOCAL read - no socket - so a panel may ask it on open. Null on a project
         * whose server does not ask who is calling, which is every bare `loreserver`.
         */
        getServerSession(projectPath: string): Promise<RequestStatus<{ session: VcsServerSession | null }>>;
        /**
         * Sign this installation in to this project's server with a token its operator
         * issued.
         *
         * **Goes to the network**, and to two different places: the sign-in endpoint,
         * then the server itself so the answer can say whether the two ends can work
         * together. Failures carry a coded reason rather than a sentence, because the
         * backend reports four unrelated transport problems with one string.
         *
         * The token is handed on and forgotten. It is not stored by Studio and does not
         * come back in the response.
         */
        signIn(projectPath: string, authUrl: string, token: string): Promise<RequestStatus<VcsSignInOutcome>>;
        /**
         * Put a server's certificate authority into this account's trust store.
         *
         * **Changes a setting of the operating system**, which nothing else on this
         * interface does. Only a certificate Studio itself wrote is eligible.
         */
        trustAuthority(projectPath: string, certificatePath: string): Promise<RequestStatus<{ installed: boolean; output: string }>>;
        /** Clear the stored token and Studio's record of whose it was. Local. */
        signOut(projectPath: string): Promise<RequestStatus<{ session: null }>>;
        /**
         * Ask an `nlteam://` address what is behind it.
         *
         * **Goes to the network.** The first step of adding a server, and the only one
         * that happens before the author has decided anything: the answer says whether
         * to carry on, to ask about a certificate, or to say nothing was there.
         */
        probeServer(address: string): Promise<RequestStatus<VcsServerProbe>>;
        /**
         * Every server this installation is signed in to. A local read, and the only
         * one of these calls that takes no project.
         *
         * Settings is the caller: servers belong to the machine, so they are listed and
         * managed with no project open.
         */
        listServers(): Promise<RequestStatus<{ servers: VcsServerSession[] }>>;
        /**
         * Sign in to the server a token names, rather than to a project's server.
         *
         * **Goes to the network.** Pass empty strings for the two addresses: a token
         * carries both, and they are asked for only after this answers that it does not.
         */
        addServer(authUrl: string, remoteUrl: string, token: string): Promise<RequestStatus<VcsAddServerOutcome>>;
        /** Take a server off this machine, token and record together. Local. */
        forgetServer(remoteOrigin: string): Promise<RequestStatus<{ servers: VcsServerSession[] }>>;
        /**
         * What one server holds. **Goes to the network.**
         *
         * Answered afresh every time rather than from anything kept here: a list that was
         * right when it was stored is wrong the moment somebody else pushes.
         */
        listServerProjects(remoteOrigin: string): Promise<RequestStatus<VcsServerProjectsOutcome>>;
        /** Ask a server to make a project. **Goes to the network, and writes there.** */
        createServerProject(
            remoteOrigin: string,
            name: string,
            description?: string,
        ): Promise<RequestStatus<VcsServerProjectOutcome>>;
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
    /**
     * The project's distribution key: the one value that ties a shipped build to
     * the project that made it, so an add-on produced later can be read by that
     * build and recognised as coming from the same place.
     *
     * Minting is the only operation. Nothing reads it back — it lives in the
     * project manifest, travels with the project, and is never shown.
     */
    distribution: {
        /**
         * Mint a key. Replacing an existing one is the caller's decision and its
         * consequence: builds already shipped under the old key stop accepting
         * add-ons made after the replacement.
         */
        createKey(): Promise<RequestStatus<{ key: string }>>;
    };
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

    /**
     * Plugin build-config secrets, in the same machine vault the signing
     * passwords live in. The value goes up once and a handle comes back; there is
     * no entry that reads a value out.
     */
    pluginBuildSecret: {
        /**
         * Seal `value` and answer the handle the project stores. Pass `handle` to
         * fill in one the project already refers to. `value` is plain text - do
         * not log it or hold it after the call resolves.
         */
        set(value: string, handle?: string): Promise<RequestStatus<{ handle: string; available: boolean }>>;
        /**
         * Whether the secret behind a handle is on this machine. False is the
         * ordinary answer for a project a collaborator configured, and means
         * "set, not available here" rather than "empty".
         */
        available(handle: string): Promise<RequestStatus<{ available: boolean }>>;
    };

    blueprintPersistence: {
        getAll(projectRef: BlueprintPersistenceProjectRef): Promise<RequestStatus<{ values: Record<string, unknown> }>>;
        getValue(projectRef: BlueprintPersistenceProjectRef, key: string): Promise<RequestStatus<{ value: unknown }>>;
        setValue(projectRef: BlueprintPersistenceProjectRef, key: string, value: unknown): Promise<RequestStatus<void>>;
        removeValue(projectRef: BlueprintPersistenceProjectRef, key: string): Promise<RequestStatus<void>>;
    };

    blueprintNetwork: {
        /**
         * One Fetch node request, issued by the main process for a Dev Mode preview.
         *
         * `projectPath` decides whose Allow HTTP setting applies; the handler reads it off disk
         * rather than taking the renderer's word for it.
         */
        fetch(
            projectPath: string,
            request: BlueprintNetworkFetchRequest,
        ): Promise<RequestStatus<{ result: BlueprintNetworkFetchResult }>>;
    };

    blueprintPointer: {
        /**
         * One Move Mouse node request, performed by the main process for a Dev Mode preview.
         *
         * The point is in CSS pixels from the top-left of the web contents. The window it belongs
         * to is the one that sent it - the renderer never names a window, and could not usefully:
         * the only position it can speak about is a position inside itself.
         */
        move(request: BlueprintPointerMoveRequest): Promise<RequestStatus<{ result: BlueprintPointerMoveResult }>>;
    };

    blueprintExternalLink: {
        /**
         * One Open Link node request, decided and performed by the main process for a Dev Mode
         * preview.
         *
         * `projectPath` decides whose declared addresses apply; the handler reads them off disk
         * rather than taking the renderer's word for it, so a preview refuses exactly what the
         * shipped game refuses.
         */
        open(
            projectPath: string,
            request: BlueprintOpenExternalRequest,
        ): Promise<RequestStatus<{ result: BlueprintOpenExternalResult }>>;
        /**
         * One runtime plugin's request, decided against that plugin's declared patterns.
         *
         * No project path: a plugin's declaration is the plugin's, identical in every project it is
         * installed into, so the project is not what decides this one.
         */
        openForPlugin(
            pluginId: string,
            request: BlueprintOpenExternalRequest,
        ): Promise<RequestStatus<{ result: BlueprintOpenExternalResult }>>;
    };

    blueprintProgress: {
        /**
         * One Export Progress node request, performed by the main process for a Dev Mode preview.
         *
         * `projectPath` decides which title's document is written; the handler derives the key from
         * the project's identity rather than taking one from the renderer, so a preview writes the
         * same file the shipped build would and can reach no other.
         */
        write(
            projectPath: string,
            request: GameProgressExportRequest,
        ): Promise<RequestStatus<{ result: GameProgressExportResult }>>;
        /** One Import Progress node request, read from the same file and keyed the same way. */
        read(projectPath: string): Promise<RequestStatus<{ result: GameProgressImportResult }>>;
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
        /** Documents only, for the store's cards. See {@link UITemplatePreview}. */
        fetchPreviews(templateIds: string[]): Promise<RequestStatus<UITemplatePreview[]>>;
        /** Theme poster images, for the browse level. */
        fetchThemePreviews(themeIds: string[]): Promise<RequestStatus<UIThemePreview[]>>;
    };

    /** Project templates bundled with this build (resources/templates). */
    projectTemplates: {
        list(): Promise<RequestStatus<ProjectTemplateDescriptor[]>>;
        scaffold(templateId: string, projectPath: string): Promise<RequestStatus<{ filesCopied: number }>>;
    };

    assets: {
        /**
         * The bytes behind a remote asset's URL, fetched by main.
         *
         * The only way a renderer may obtain them: renderers do not talk to the network, so neither
         * `fetch()` nor an `<img src>` pointed at a project's remote URL is allowed. Pass
         * `validators` from the asset's record to make the request conditional — an unchanged asset
         * then answers `not-modified` and transfers nothing.
         */
        fetchRemote(url: string, validators?: RemoteAssetValidators): Promise<RequestStatus<RemoteAssetFetchResult>>;

        /**
         * Ask for a folder and copy the named library files into it.
         *
         * The dialog belongs to this call: a folder the renderer picks for itself is granted read
         * access only, so the copying has to happen on the side that can widen the grant. Cancelling
         * the dialog is a success carrying `canceled: true`, not a failure.
         */
        exportToFolder(entries: AssetExportEntry[]): Promise<RequestStatus<AssetExportResult>>;
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
