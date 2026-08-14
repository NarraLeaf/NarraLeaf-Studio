import path from "path";
import crypto from "crypto";
import chokidar, { FSWatcher } from "chokidar";
import { App } from "@/app/app";
import { AppWindow } from "../window/appWindow";
import { IPCEventType } from "@shared/types/ipcEvents";
import { BRAND_DOCUMENT_PATH } from "@shared/documents/specs";
import { ATOMIC_WRITE_TEMP_PATTERN } from "@shared/utils/fs";
import { DevModeBundle, DevModeConsoleLogPayload, DevModeEntry, DevModeStatus } from "@shared/types/devMode";
import type { RevisionId } from "@shared/types/vcs";
import { WindowAppType } from "@shared/types/window";
import { INLangCompiler, NullNLangCompiler } from "./compiler/INLangCompiler";
import { compileAllBlueprintScriptsForProject } from "./compiler/blueprint/compileProjectBlueprintScripts";
import { devModeDiskBundleSource } from "./pipeline/bundleAssembler";
import type { DevModeBundleSource } from "./pipeline/types";
import { resolveRunVariant } from "../../utils/runVariant";
import { resolveDevModeLaunchSource } from "./revisionLaunchSource";
import { removeRevisionSnapshots } from "../vcs/revisionSnapshot";

type DevModeSession = {
    id: string;
    projectPath: string;
    /**
     * The directory the compile path reads, which is NOT always the project.
     *
     * While the workspace is showing a past revision, this is a snapshot of that revision and the
     * author's own files are left alone. Everything that identifies the
     * session - the key in `sessions`, which workspace window gets its console output, which project's
     * freeze is consulted - stays `projectPath`; only reads move.
     */
    sourcePath: string;
    /** Set when {@link sourcePath} is a snapshot. Also what stops the file watcher being installed. */
    sourceRevision?: RevisionId;
    entry: DevModeEntry;
    status: DevModeStatus;
    window: AppWindow<WindowAppType.DevMode> | null;
    windowReady: boolean;
    revision: number;
    watcher: FSWatcher | null;
    pendingBundle: DevModeBundle | null;
    pendingError: string | null;
    reloadTimer: ReturnType<typeof setTimeout> | null;
};

export class DevModeManager {
    /**
     * Upper bound on how long the main process holds the Dev Mode window's close open while the
     * renderer's blueprints decide whether to intercept it. A synchronous decision returns in
     * milliseconds; the timeout only bounds a hung/crashed renderer, after which the window closes
     * (the documented default is that the window closes unless a blueprint cancels it).
     */
    private static readonly CloseDecisionTimeoutMs = 60 * 1000;

    /**
     * Live sessions, one per project.
     *
     * Keyed rather than a single field because two projects can be open at once, and each owns its
     * own Dev Mode: launching one must not tear down the other's window, and a workspace asking for
     * status must be told about its own project rather than whichever session happens to exist.
     * Same shape as PreviewManager and GameBuildManager, which are keyed the same way.
     */
    private readonly sessions = new Map<string, DevModeSession>();
    /** Serializes launch/stop/reload per project, so a quick stop-then-start cannot interleave. */
    private readonly operations = new Map<string, Promise<DevModeStatus>>();
    /** In-flight snapshot removal per project. See {@link discardSnapshot} for why it must be shared. */
    private readonly snapshotDiscards = new Map<string, Promise<void>>();
    private readonly compiler: INLangCompiler;
    private readonly bundleSource: DevModeBundleSource;

    constructor(private readonly app: App, compiler?: INLangCompiler, bundleSource?: DevModeBundleSource) {
        this.compiler = compiler ?? new NullNLangCompiler();
        this.bundleSource = bundleSource ?? devModeDiskBundleSource;
    }

    /**
     * Dev Mode status for a project. Without a path this reports whether *any* project is running,
     * which only the app-wide surfaces (quit checks) should ask for - a workspace always passes its
     * own path, or it would show a neighbouring project's state as its own.
     */
    public getStatus(projectPath?: string): DevModeStatus {
        if (projectPath) {
            return this.sessions.get(this.projectKey(projectPath))?.status ?? "idle";
        }
        return [...this.sessions.values()].find(session => session.status !== "idle")?.status ?? "idle";
    }

    public launch(projectPath: string, entry: DevModeEntry): Promise<DevModeStatus> {
        return this.enqueue(projectPath, () => this.launchNow(projectPath, entry));
    }

    public stop(projectPath: string): Promise<DevModeStatus> {
        return this.enqueue(projectPath, async () => {
            const session = this.sessions.get(this.projectKey(projectPath));
            if (!session) {
                return "idle";
            }
            this.emitVerbose(session, "stop requested");
            await this.terminateSession(session);
            return "idle";
        });
    }

    /**
     * Recompile what this session is already running.
     *
     * Deliberately does NOT re-resolve where it compiles from: a session launched against a past
     * revision keeps that revision until it is stopped. Re-resolving would mean a reload silently
     * switching between the revision and the working tree depending on what the workspace happened to
     * be showing at the moment a file changed.
     */
    public reload(projectPath: string): Promise<DevModeStatus> {
        return this.enqueue(projectPath, async () => {
            const session = this.sessions.get(this.projectKey(projectPath));
            if (!session) {
                return "idle";
            }
            try {
                this.emitVerbose(session, "reload requested");
                await this.compileAndSendBundle(session, "reloading");
                return session.status;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.app.logger.error("[DevMode] reload failed", err);
                session.status = "error";
                this.emitWorkspaceConsoleLog(session, {
                    level: "error",
                    source: "Dev Mode",
                    message: `reload failed: ${message}`,
                });
                this.queueSessionError(session, message);
                return "error";
            }
        });
    }

    private async launchNow(projectPath: string, entry: DevModeEntry): Promise<DevModeStatus> {
        const key = this.projectKey(projectPath);
        // Only this project's session is replaced; other projects keep running.
        const previous = this.sessions.get(key);
        if (previous) {
            await this.terminateSession(previous);
        }

        const session = this.createSession(projectPath, entry);
        this.sessions.set(key, session);

        try {
            this.emitVerbose(session, `launch requested: ${this.describeEntry(entry)}`);
            // Before the window, so a revision that cannot be read refuses the launch instead of
            // opening a Dev Mode window that then has nothing to show.
            await this.resolveLaunchSource(session);
            await this.startOrFocusWindow(session);
            await this.compileAndSendBundle(session, "starting");
            this.watchProjectFiles(session);
            return session.status;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.app.logger.error("[DevMode] launch failed", err);
            session.status = "error";
            this.emitWorkspaceConsoleLog(session, {
                level: "error",
                source: "Dev Mode",
                message: `launch failed: ${message}`,
            });
            this.queueSessionError(session, message);
            return "error";
        }
    }

    /**
     * Point this session at what the author is looking at: the working tree, or a snapshot of the
     * revision the workspace is showing.
     *
     * Progress goes to the workspace console, which is where every other stage of a launch already
     * reports - materialising a revision on a project with a remote can fetch fragments over the
     * network (docs/version-control.md §6), and a launch that looks hung with nothing to read is worse
     * than a slow one that says what it is doing.
     */
    private async resolveLaunchSource(session: DevModeSession): Promise<void> {
        const source = await resolveDevModeLaunchSource({
            projectPath: session.projectPath,
            materialize: revision => this.app.getVcsManager().materializeRevisionSnapshot(
                session.projectPath,
                revision,
                {
                    onProgress: message => this.emitWorkspaceConsoleLog(session, {
                        level: "info",
                        source: "Dev Mode",
                        message,
                    }),
                },
            ),
        });
        session.sourcePath = source.directory;
        session.sourceRevision = source.revision;
        if (!source.revision) {
            // A snapshot left by an earlier revision launch (or by a crash) has no owner once this
            // session runs the working tree, and nothing else would ever remove it.
            await removeRevisionSnapshots(session.projectPath);
            return;
        }
        this.emitWorkspaceConsoleLog(session, {
            level: "info",
            source: "Dev Mode",
            message: `running version ${source.revision.slice(0, 12)}, not your current files, because that is`
                + " what the workspace is showing. Asset files still come from your project.",
        });
    }

    private createSession(projectPath: string, entry: DevModeEntry): DevModeSession {
        return {
            id: crypto.randomUUID(),
            projectPath,
            // Replaced by `resolveLaunchSource` when a revision is on screen. Defaulted rather than
            // left undefined so a session is never in a state where "what do I compile" has no answer.
            sourcePath: projectPath,
            entry,
            status: "starting",
            window: null,
            windowReady: false,
            revision: 0,
            watcher: null,
            pendingBundle: null,
            pendingError: null,
            reloadTimer: null,
        };
    }

    private async startOrFocusWindow(session: DevModeSession): Promise<void> {
        if (session.window && !session.window.isClosed()) {
            this.emitVerbose(session, "focusing existing Dev Mode window");
            session.window.show();
            session.window.win.focus();
            return;
        }

        this.emitVerbose(session, "creating Dev Mode window");
        // The window keeps the PROJECT path even when the bundle came from a snapshot, and both halves
        // of that are deliberate. It is how the window finds its workspace - which is who resolves its
        // asset URLs, and where its console output goes - and `launchDevMode` reads the network policy
        // (`allowHttp`) from the config on disk, which must be the author's current one: a past revision
        // does not get to widen what the runtime is allowed to reach.
        const window = await this.app.launchDevMode({
            projectPath: session.projectPath,
            entry: session.entry,
        });
        session.window = window;
        session.windowReady = false;
        window.onClose(() => {
            this.disposeWatcher(session);
            this.clearReloadTimer(session);
            this.forgetSession(session);
            // The window can close without anyone having asked (the native close box), so this path has
            // to discard too - and nothing here can await it. `discardSnapshot` shares one removal per
            // project, so a `stop()` arriving around the same time awaits THIS work rather than starting
            // a second remove of the same tree.
            void this.discardSnapshot(session).catch(error => {
                this.app.logger.warn("[DevMode] snapshot cleanup failed after the window closed", error);
            });
        });
        window.onReady(() => {
            session.windowReady = true;
            this.emitVerbose(session, "Dev Mode window ready");
            this.tryFlushPendingToDevWindow(session);
        });
        // Feeds the `On Fullscreen Changed` blueprint head, so it also fires for
        // fullscreen toggled outside the game (macOS green button, OS shortcuts).
        const forwardFullscreen = (isFullscreen: boolean) => () => {
            if (!window.isClosed() && !window.isDestroyed()) {
                window.sendIpcEvent(IPCEventType.devModeFullscreenChanged, { isFullscreen });
            }
        };
        window.win.on("enter-full-screen", forwardFullscreen(true));
        window.win.on("leave-full-screen", forwardFullscreen(false));

        // Give the game's blueprints a chance to intercept a user-initiated window close (native
        // close box, OS shortcut) via the `On Window Close Requested` head. Swallow the close, ask
        // the renderer, and re-issue it through forceClose() when nothing cancelled it. Programmatic
        // teardown (Quit Application node, workspace stop button, relaunch) uses forceClose() and so
        // bypasses this entirely - that path must never fire the blueprint close event.
        let closeRequestPending = false;
        window.setCloseGuard(() => {
            if (closeRequestPending) {
                // A second close while the last decision is still settling: surface the window
                // rather than stacking requests.
                window.focus();
                return true;
            }
            closeRequestPending = true;
            void this.handleWindowCloseRequest(session, window)
                .catch(err => this.app.logger.error("[DevMode] window close request failed", err))
                .finally(() => {
                    closeRequestPending = false;
                });
            return true;
        });
    }

    /**
     * Ask the Dev Mode renderer whether the window may close and act on the answer. Anything other
     * than an explicit "cancel" closes the window: a close that fails open is far better than one
     * that traps the user, and quitting the app works regardless (the close guard stands aside once
     * the app is quitting).
     */
    private async handleWindowCloseRequest(
        session: DevModeSession,
        window: AppWindow<WindowAppType.DevMode>,
    ): Promise<void> {
        const allow = await this.requestBlueprintCloseDecision(window);
        if (!allow) {
            this.emitVerbose(session, "window close cancelled by blueprint");
            return;
        }
        if (window.isClosed() || this.app.isQuitting()) {
            return;
        }
        window.forceClose();
    }

    private async requestBlueprintCloseDecision(window: AppWindow<WindowAppType.DevMode>): Promise<boolean> {
        try {
            const result = await window.invokeIpcRequest(
                IPCEventType.devModeWindowCloseRequested,
                {},
                { timeoutMs: DevModeManager.CloseDecisionTimeoutMs },
            );
            if (!result.success) {
                this.app.logger.warn(`[DevMode] close decision failed, closing the window: ${result.error}`);
                return true;
            }
            return result.data.allow;
        } catch (error) {
            this.app.logger.warn(`[DevMode] no answer to the close decision, closing the window: ${String(error)}`);
            return true;
        }
    }

    private async compileAndSendBundle(session: DevModeSession, status: DevModeStatus): Promise<void> {
        this.emitVerbose(session, `bundle pipeline requested: ${status}`);
        session.status = status;
        if (status === "starting" || status === "reloading") {
            session.status = "compiling";
        }
        this.emitVerbose(session, `status set to ${session.status}`);

        try {
            let started = Date.now();
            this.emitVerbose(session, "nlang compile started");
            // `sourcePath`, not `projectPath`, for all three stages below — that is the whole of it.
            // The compile path is path-driven end to end, so running a past revision is a matter of
            // which directory it reads - see `revisionLaunchSource.ts`.
            const compileResult = await this.compiler.compile({ projectPath: session.sourcePath });
            if (!compileResult.ok) {
                const detail = (compileResult.errors ?? []).join("\n") || "nlang compile failed";
                session.status = "error";
                this.app.logger.error("[DevMode] nlang compile failed", compileResult.errors ?? []);
                this.emitWorkspaceConsoleLog(session, {
                    level: "error",
                    source: "Dev Mode",
                    message: `nlang compile failed:\n${detail}`,
                });
                this.queueSessionError(session, `nlang compile failed:\n${detail}`);
                return;
            }
            this.emitVerbose(session, `nlang compile finished in ${Date.now() - started} ms`);

            started = Date.now();
            this.emitVerbose(session, "Blueprint script compile started");
            const blueprintScripts = await compileAllBlueprintScriptsForProject(session.sourcePath);
            if (!blueprintScripts.ok) {
                const detail = blueprintScripts.errors.join("\n") || "TypeScript blueprint compile failed";
                session.status = "error";
                this.app.logger.error("[DevMode] TypeScript blueprint compile failed", blueprintScripts.errors);
                this.emitWorkspaceConsoleLog(session, {
                    level: "error",
                    source: "Dev Mode",
                    message: `Blueprint script compile failed:\n${detail}`,
                });
                this.queueSessionError(session, `Blueprint script compile failed:\n${detail}`);
                return;
            }
            this.emitVerbose(
                session,
                `Blueprint script compile finished in ${Date.now() - started} ms (${Object.keys(blueprintScripts.scripts).length} script(s))`,
            );

            session.revision += 1;
            started = Date.now();
            this.emitVerbose(session, `bundle assembly started: revision ${session.revision}`);
            const runVariant = await resolveRunVariant(this.app.getGlobalState(), session.projectPath);
            const bundle = await this.bundleSource.load({
                projectPath: session.sourcePath,
                bundleId: session.id,
                revision: session.revision,
                // Read per rebuild rather than captured on the session: an author switching edition
                // expects the next reload to be the other one, not to have to stop and start.
                // `packaging` stays off, so this folds the variant and plans no scene drop.
                ...(runVariant ? { appTag: { id: runVariant.id, name: runVariant.name } } : {}),
                onNotice: message => this.emitWorkspaceConsoleLog(session, {
                    level: "info",
                    source: "Dev Mode",
                    message,
                }),
                compiled: compileResult.artifacts,
                blueprintCompiledScripts: blueprintScripts.scripts,
                blueprintScriptsCompileOk: true,
            });
            this.emitVerbose(session, `bundle assembly finished in ${Date.now() - started} ms`);
            this.sendBundle(session, bundle);
            session.status = "running";
            this.emitVerbose(session, "status set to running");
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            session.status = "error";
            this.app.logger.error("[DevMode] bundle assembly failed", err);
            this.emitWorkspaceConsoleLog(session, {
                level: "error",
                source: "Dev Mode",
                message: `Dev Mode bundle failed:\n${message}`,
            });
            this.queueSessionError(session, `Dev Mode bundle failed:\n${message}`);
        }
    }

    private queueSessionError(session: DevModeSession, message: string): void {
        session.pendingBundle = null;
        session.pendingError = message;
        this.tryFlushPendingToDevWindow(session);
    }

    private sendBundle(session: DevModeSession, bundle: DevModeBundle): void {
        session.pendingError = null;
        session.pendingBundle = bundle;
        this.emitVerbose(session, `bundle queued for Dev Mode window: revision ${bundle.revision}`);
        this.tryFlushPendingToDevWindow(session);
    }

    private tryFlushPendingToDevWindow(session: DevModeSession): void {
        const window = session.window;
        if (!window || window.isClosed() || !session.windowReady) {
            return;
        }
        if (session.pendingError) {
            window.sendIpcEvent(IPCEventType.devModeControlError, { message: session.pendingError });
            this.emitVerbose(session, "sent error payload to Dev Mode window");
            session.pendingError = null;
        }
        if (session.pendingBundle) {
            const revision = session.pendingBundle.revision;
            window.sendIpcEvent(IPCEventType.devModePayloadUpdate, { bundle: session.pendingBundle });
            window.sendIpcEvent(IPCEventType.devModeControlReload, { revision: session.pendingBundle.revision });
            this.emitVerbose(session, `sent bundle payload to Dev Mode window: revision ${revision}`);
            session.pendingBundle = null;
        }
    }

    private watchProjectFiles(session: DevModeSession): void {
        if (session.watcher) {
            return;
        }
        if (session.sourceRevision) {
            // Nothing to watch. The snapshot cannot change, and watching the WORKING TREE instead
            // would reload a running revision every time the author saved something that has nothing
            // to do with it - and reload it back to the same bytes, so the only visible effect would be
            // the game restarting for no reason.
            this.emitVerbose(session, "not watching project files: this session runs a past revision");
            return;
        }
        const uidocPath = path.join(session.projectPath, "editor", "ui", "uidoc.json");
        const uigraphsPath = path.join(session.projectPath, "editor", "ui", "uigraphs.json");
        const storyRoot = path.join(session.projectPath, "editor", "story");
        const localizationRoot = path.join(session.projectPath, "editor", "localization");
        const characterStorePath = path.join(session.projectPath, "editor", "services", "character.json");
        // The brand palette is baked into the bundle exactly like the documents above it, so it
        // belongs on this list for exactly their reason: what the running preview shows is the
        // palette the last compile read, and a colour the author changes is not that palette until
        // another compile happens. Left off, the preview keeps its start-up colours for the rest of
        // the session with nothing reporting why - which reads as "the brand feature does not work"
        // rather than as a missing watch, and is the hardest form of this bug to find afterwards.
        const brandPath = path.join(session.projectPath, BRAND_DOCUMENT_PATH);
        const assetsRoot = path.join(session.projectPath, "assets");
        const blueprintMetaPath = path.join(assetsRoot, "assets.metadata.blueprint.json");
        const assetsContentRoot = path.join(assetsRoot, "content");
        this.emitVerbose(session, "watching project files for Dev Mode reload");
        session.watcher = chokidar.watch(
            [uidocPath, uigraphsPath, storyRoot, localizationRoot, characterStorePath, brandPath, blueprintMetaPath, assetsContentRoot],
            // Atomic writes put a scratch sibling in the tree for a few milliseconds before renaming
            // it into place. Reporting it would schedule a reload against a file that is already
            // gone, on top of the reload the rename itself triggers.
            { ignoreInitial: true, ignored: ATOMIC_WRITE_TEMP_PATTERN },
        );
        session.watcher.on("add", file => this.scheduleReload(session, "add", file));
        session.watcher.on("change", file => this.scheduleReload(session, "change", file));
        session.watcher.on("unlink", file => this.scheduleReload(session, "unlink", file));
    }

    private scheduleReload(session: DevModeSession, event: string, file: string): void {
        this.clearReloadTimer(session);
        this.emitVerbose(session, `project file ${event}; scheduling reload: ${path.relative(session.projectPath, file)}`);
        session.reloadTimer = setTimeout(() => {
            session.reloadTimer = null;
            void this.reload(session.projectPath).catch(err => {
                this.app.logger.error("[DevMode] reload failed", err);
            });
        }, 200);
    }

    private clearReloadTimer(session: DevModeSession): void {
        if (!session.reloadTimer) {
            return;
        }
        clearTimeout(session.reloadTimer);
        session.reloadTimer = null;
    }

    private async terminateSession(session: DevModeSession): Promise<void> {
        session.status = "stopping";
        this.emitVerbose(session, "terminating Dev Mode session");
        this.disposeWatcher(session);
        this.clearReloadTimer(session);
        if (session.window && !session.window.isClosed()) {
            // forceClose bypasses the blueprint close guard: a programmatic stop (Quit Application
            // node, workspace stop button, relaunch) is not the user closing the window, so it must
            // not fire the On Window Close Requested event.
            session.window.forceClose();
        }
        this.forgetSession(session);
        await this.discardSnapshot(session);
    }

    /**
     * Delete the snapshot this session was running, once nothing is running it.
     *
     * Guarded against the relaunch race rather than unconditional: a replacement session is installed
     * before the outgoing window's `close` event arrives, and the snapshot directory is per project, so
     * an unguarded removal here would delete the directory the NEW session is compiling from and turn a
     * relaunch into a file-not-found.
     *
     * **Single-flight per project, and that is a correctness fix rather than an optimisation.** Stopping
     * a session closes its window, and the window's own `close` handler discards too, so two removals of
     * one tree used to be started at once - MEASURED: two concurrent recursive removes of the same tree
     * fail on Windows 20 times out of 20, one of them with EPERM. The loser returned early having done
     * nothing, so `stop()` resolved while the tree was still going away: a caller that awaited the
     * discard had no guarantee, and a genuine failure was invisible because it was swallowed. Sharing
     * one promise means whoever awaits it awaits the work.
     */
    private async discardSnapshot(session: DevModeSession): Promise<void> {
        if (!session.sourceRevision) {
            return;
        }
        const key = this.projectKey(session.projectPath);
        const current = this.sessions.get(key);
        if (current && current !== session) {
            return;
        }
        const inFlight = this.snapshotDiscards.get(key);
        if (inFlight) {
            await inFlight;
            return;
        }
        const discard = removeRevisionSnapshots(session.projectPath)
            .then(removed => {
                if (!removed) {
                    // Not fatal - the next launch clears the root and refuses if it cannot - but it is
                    // disk sitting in the author's project, so it does not go unsaid.
                    this.app.logger.warn(
                        "[DevMode] could not remove the revision snapshot; it will be cleared on the next launch",
                        session.projectPath,
                    );
                }
            })
            .finally(() => {
                if (this.snapshotDiscards.get(key) === discard) {
                    this.snapshotDiscards.delete(key);
                }
            });
        this.snapshotDiscards.set(key, discard);
        await discard;
    }

    /**
     * Drop a session from the table, but only if it is still the current one for its project - a
     * relaunch installs its replacement before the outgoing window's close event arrives, and that
     * late event must not evict the new session.
     */
    private forgetSession(session: DevModeSession): void {
        const key = this.projectKey(session.projectPath);
        if (this.sessions.get(key) === session) {
            this.sessions.delete(key);
        }
    }

    private enqueue(projectPath: string, operation: () => Promise<DevModeStatus>): Promise<DevModeStatus> {
        const key = this.projectKey(projectPath);
        const previous = this.operations.get(key) ?? Promise.resolve("idle" as DevModeStatus);
        const next = previous
            .catch(() => "error" as DevModeStatus)
            .then(operation);
        const tracked = next.finally(() => {
            if (this.operations.get(key) === tracked) {
                this.operations.delete(key);
            }
        });
        this.operations.set(key, tracked);
        return next;
    }

    private projectKey(projectPath: string): string {
        return path.resolve(projectPath);
    }

    private disposeWatcher(session: DevModeSession): void {
        if (!session.watcher) {
            return;
        }
        void session.watcher.close();
        session.watcher = null;
    }

    private emitVerbose(session: DevModeSession, message: string): void {
        this.emitWorkspaceConsoleLog(session, {
            level: "verbose",
            source: "Dev Mode",
            message,
        });
    }

    private emitWorkspaceConsoleLog(session: DevModeSession, payload: DevModeConsoleLogPayload): void {
        const workspaceWindow = this.findWorkspaceWindow(session.projectPath);
        if (!workspaceWindow) {
            return;
        }
        workspaceWindow.sendIpcEvent(IPCEventType.workspaceDevModeConsoleLog, {
            timestamp: Date.now(),
            ...payload,
        });
    }

    private findWorkspaceWindow(projectPath: string): AppWindow<WindowAppType.Workspace> | undefined {
        return this.app.windowManager
            .getWindows()
            .find(
                w =>
                    w.getWindowType() === WindowAppType.Workspace &&
                    !w.isDestroyed() &&
                    !w.isClosed() &&
                    path.normalize(w.getProps().projectPath) === path.normalize(projectPath),
            ) as AppWindow<WindowAppType.Workspace> | undefined;
    }

    private describeEntry(entry: DevModeEntry): string {
        if (entry.kind === "surface") {
            return `surface ${entry.surfaceId}`;
        }
        if (entry.kind === "story") {
            return `story ${entry.storyId}/${entry.sceneId}${entry.blockId ? `@${entry.blockId}` : ""}`;
        }
        return `extension ${entry.extensionId}`;
    }
}
