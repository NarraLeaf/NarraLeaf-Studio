import { screen } from "electron";
import { IPCEventType, WorkspaceCloseStage } from "@shared/types/ipcEvents";
import { WindowAppType, WindowControlPolicy, WindowProps } from "@shared/types/window";
import { BaseApp, BaseAppConfig } from "./application/baseApp";
import { getGameHostWindowBackgroundColor } from "./application/theme";
import { AppWindow, WindowConfig } from "./application/managers/window/appWindow";
import { DevModeManager } from "./application/managers/devMode/DevModeManager";
import { devModeNetworkPolicy, readProjectAllowHttp } from "./application/managers/devMode/devModeNetworkPolicy";
import { GameBuildManager } from "./application/managers/build/GameBuildManager";
import { GameTestManager } from "./application/managers/gameTest/GameTestManager";
import { MediaConvertManager } from "./application/managers/media/MediaConvertManager";
import { PreviewManager } from "./application/managers/preview/PreviewManager";
import { VcsManager } from "./application/managers/vcs/VcsManager";
// Shared with the recently-opened history, which must agree with the "already open?" lookup here.
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { ONBOARDING_STATE_KEY, needsOnboarding } from "@shared/constants/onboarding";

export interface AppConfig extends BaseAppConfig {
}

/**
 * How long the close-time checkpoint may take before the window closes without it.
 *
 * Generous, because a commit's duration is a function of how much the author changed and giving up
 * early loses the revision. Bounded, because the alternative is a window that cannot be closed:
 * every Lore call queues per project, and one that is waiting on the repository lock - another
 * process holding it, or Studio's own handle from earlier in the session - waits without a deadline
 * of its own. A close is not the moment to find that out.
 */
const CLOSE_CHECKPOINT_TIMEOUT_MS = 30_000;

/**
 * How far a workspace opening beside another one is stepped from it, so the new window is visibly
 * a second window rather than the same frame with different contents.
 */
const WINDOW_CASCADE_STEP = 32;

export class App extends BaseApp {
    public static create(config: AppConfig): App {
        return new App(config);
    }

    constructor(public readonly config: AppConfig) {
        super(config);
        this.devModeManager = new DevModeManager(this);
        this.previewManager = new PreviewManager(this);
        this.gameTestManager = new GameTestManager(this);
        this.gameBuildManager = new GameBuildManager(this);
        this.mediaConvertManager = new MediaConvertManager(this);
        // The commit pipeline has to settle the renderer's auto-save debt before it
        // stages, and only the window layer can ask a window to do that. Handed in as a
        // function because VcsManager holds a BaseApp: without it a commit would still
        // succeed and would describe a document that is about to change on disk.
        this.vcsManager = new VcsManager(this, async projectPath => {
            const workspace = this.findWorkspaceForProject(projectPath);
            if (workspace) {
                await this.flushWorkspacePendingSaves(workspace);
            }
        });
    }

    private readonly devModeManager: DevModeManager;
    private readonly previewManager: PreviewManager;
    private readonly gameTestManager: GameTestManager;
    private readonly gameBuildManager: GameBuildManager;
    private readonly mediaConvertManager: MediaConvertManager;
    private readonly vcsManager: VcsManager;

    public getDevModeManager(): DevModeManager {
        return this.devModeManager;
    }

    public getPreviewManager(): PreviewManager {
        return this.previewManager;
    }

    /** Game processes a test run owns. Separate from the preview's for the reasons in its header. */
    public getGameTestManager(): GameTestManager {
        return this.gameTestManager;
    }

    public getGameBuildManager(): GameBuildManager {
        return this.gameBuildManager;
    }

    /** ffmpeg conversions in flight. Polled by job id, in the same shape as a production build. */
    public getMediaConvertManager(): MediaConvertManager {
        return this.mediaConvertManager;
    }

    public getVcsManager(): VcsManager {
        return this.vcsManager;
    }

    private applyWindowIcon(window: AppWindow): void {
        const iconPath = this.getWindowIconPath();
        if (!iconPath) {
            return;
        }

        window.setIcon(iconPath);
    }

    /**
     * Whether the launcher about to be built should open in first-run setup.
     *
     * Answered here, in the main process, because the answer is available synchronously - one
     * `globalState.get` - and can therefore travel with the window instead of being fetched by a
     * renderer that has already painted something else.
     *
     * The marker is written when the flow is deliberately finished or skipped, never on the way
     * in. So quitting mid-setup replays it next time, and a workspace closing back to the launcher
     * (`ensureLauncher`) does not re-offer setup to someone who already answered.
     */
    private shouldRunOnboarding(): boolean {
        if (this.wantsOnboardingRerun()) {
            return true;
        }
        return needsOnboarding(this.globalState.get(ONBOARDING_STATE_KEY));
    }

    async launchLauncher(options: Partial<Electron.BrowserWindowConstructorOptions>): Promise<AppWindow<WindowAppType.Launcher>> {
        const config: WindowConfig<WindowAppType.Launcher> = {
            windowType: WindowAppType.Launcher,
            isolated: true,
            autoFocus: true,
            preload: this.getPreloadScript(),
            windowControlPolicy: WindowControlPolicy.MacNativeOutsideTitleBar,
            options: {
                minWidth: 800,
                minHeight: 500,
                maxWidth: 800,
                maxHeight: 500,
                width: 800,
                height: 500,
                frame: false,
                resizable: false,
                maximizable: false,
                titleBarStyle: 'hidden',
                show: false,
                ...options,
            },
        };
        const window = new AppWindow<WindowAppType.Launcher>(this, config, {
            onboarding: this.shouldRunOnboarding(),
        });
        window.setTitle("Launcher - NarraLeaf Studio");
        this.applyWindowIcon(window);
        window.showWhenReady();

        try {
            await window.loadFile(this.getAppEntry(WindowAppType.Launcher));
        } catch (error: any) {
            // Ignore navigation aborted during dev hot-reload
            if (error && (error.code === 'ERR_ABORTED' || error.errno === -3)) {
                this.logger.warn('[Launcher] Initial navigation aborted by reload, continuing...');
            } else {
                throw error;
            }
        }

        return window;
    }

    /** True while a launcher window is open, i.e. the user still has a home to fall back to. */
    hasAliveLauncher(): boolean {
        return this.windowManager.getWindows().some(window =>
            !window.isClosed() && window.getWindowType() === WindowAppType.Launcher
        );
    }

    /** In-flight launcher startup, shared by concurrent callers. See {@link ensureLauncher}. */
    private launcherStartup: Promise<void> | null = null;

    /**
     * Bring back the launcher, unless one is already open. Resolves once its window exists, so
     * callers can close whatever they are leaving without the app ever running windowless.
     *
     * Concurrent callers share one startup: `hasAliveLauncher` only turns true once the window
     * has been built, so two workspaces closing at the same time would otherwise each open a
     * launcher of their own.
     */
    async ensureLauncher(): Promise<void> {
        if (this.hasAliveLauncher()) {
            return;
        }
        if (this.launcherStartup) {
            return this.launcherStartup;
        }

        this.launcherStartup = this.launchLauncher({}).then(launcher => {
            launcher.onKeyUp("F12", () => {
                launcher.toggleDevTools();
            });
        }).finally(() => {
            this.launcherStartup = null;
        });

        return this.launcherStartup;
    }

    /**
     * How long to wait for the workspace's answer. This is a human pressing a button, not a
     * machine round-trip, so the default IPC timeout is far too short - timing out under a live
     * dialog would close the workspace out from under someone who was still reading it.
     */
    private static readonly ConfirmCloseTimeoutMs = 10 * 60 * 1000;

    /**
     * Ask the user whether to close the workspace. The workspace renders the prompt itself, so it
     * matches the rest of the Studio's dialogs instead of looking like a native message box.
     *
     * Anything other than an explicit "yes" keeps the window open: a confirmation that
     * auto-confirms when it fails is worse than no confirmation at all. Quitting the app still
     * works regardless, since the close guard stands aside once the app is quitting.
     */
    private async confirmWorkspaceClose(window: AppWindow<WindowAppType.Workspace>): Promise<boolean> {
        try {
            const result = await window.invokeIpcRequest(
                IPCEventType.workspaceConfirmClose,
                {},
                { timeoutMs: App.ConfirmCloseTimeoutMs },
            );
            if (!result.success) {
                this.logger.warn(`[Workspace] Close confirmation failed, keeping the window open: ${result.error}`);
                return false;
            }
            return result.data.confirmed;
        } catch (error) {
            this.logger.warn(`[Workspace] No answer to the close confirmation, keeping the window open: ${String(error)}`);
            return false;
        }
    }

    /**
     * How long to wait for one workspace to write out its pending auto-saves.
     *
     * Generous, because it covers a megabyte-plus of JSON on a slow disk, but finite: the renderer
     * applies its own per-store ceiling, and this is the backstop for a renderer that has stopped
     * answering at all. Exceeding it costs the last few seconds of edits; waiting forever costs a
     * window that will not close.
     */
    private static readonly FlushPendingSavesTimeoutMs = 15 * 1000;

    /**
     * Have a workspace write out everything it still owes the disk, and wait for it.
     *
     * The renderer's auto-save is debounced, so at any instant there is usually an edit that has
     * been typed but not written. Once the window is gone, so is the timer that would have written
     * it - and so is the `app://fs` PUT it would have travelled on. This is the only point where
     * that debt can still be settled.
     *
     * Never throws: a workspace that cannot save is not a reason to refuse to close.
     */
    public async flushWorkspacePendingSaves(window: AppWindow<WindowAppType.Workspace>): Promise<void> {
        if (window.isClosed()) {
            return;
        }
        try {
            const result = await window.invokeIpcRequest(
                IPCEventType.workspaceFlushPendingSaves,
                {},
                { timeoutMs: App.FlushPendingSavesTimeoutMs },
            );
            if (!result.success) {
                this.logger.warn(`[Workspace] Pending saves could not be flushed: ${result.error}`);
            } else if (!result.data.flushed) {
                this.logger.warn("[Workspace] Some stores failed to flush; see the workspace's Storage console channel");
            }
        } catch (error) {
            this.logger.warn(`[Workspace] No answer to the pending-save flush: ${String(error)}`);
        }
    }

    /**
     * Record a checkpoint for a project that is about to be closed.
     *
     * The point of it: after this returns, nothing is watching the working tree, so an
     * author who edited for an hour without committing would otherwise have that hour
     * recorded nowhere. Runs after the pending-save flush so the checkpoint describes
     * what they actually left behind.
     *
     * **Its own setting, not the interval's.** `versionControl.checkpointOnClose` is a
     * different question from how often to record while working - an author who turned
     * the interval off to stop being interrupted has said nothing about the one moment
     * where losing the session is possible - so a 0 interval does not silence this and
     * this does not silence the interval. Defaults on, which is what it did before it
     * was a choice.
     *
     * Never throws and never blocks the close - the second half enforced by
     * {@link CLOSE_CHECKPOINT_TIMEOUT_MS} rather than assumed. A project with no repository, a host
     * with no backend, and a tree that has not changed all answer "nothing to do" rather than
     * failing (see VcsManager.checkpoint); a repository somebody else has locked answers nothing at
     * all, and used to leave the window unclosable.
     *
     * Deliberately NOT wired into the app-quit flush as well. That path runs under a
     * hard deadline whose purpose is a bounded teardown, and a commit's duration is a
     * function of how much the author changed; hanging Cmd+Q on it would trade a
     * bounded "lost the last few seconds" for an unbounded wait. Closing a workspace
     * window comes through here first, which is the exit an author takes deliberately.
     */
    private async checkpointBeforeClose(window: AppWindow<WindowAppType.Workspace>): Promise<void> {
        // Only an explicit `false` skips it. A missing or non-boolean value means the author never
        // answered, and the answer they never gave must not be the one that loses their session.
        if (this.globalState.get("versionControl.checkpointOnClose") === false) {
            return;
        }
        const projectPath = window.getProps().projectPath;
        if (typeof projectPath !== "string" || projectPath.length === 0) {
            return;
        }
        try {
            // The checkpoint keeps running if it outlasts this; what the deadline ends is the
            // close waiting on it. Abandoning a commit half-way would be worse than a late one.
            await Promise.race([
                this.vcsManager.checkpoint(projectPath, "project-close"),
                new Promise<void>((_, reject) => setTimeout(
                    () => reject(new Error(`the checkpoint did not finish within ${CLOSE_CHECKPOINT_TIMEOUT_MS}ms`)),
                    CLOSE_CHECKPOINT_TIMEOUT_MS,
                ).unref?.()),
            ]);
        } catch (error) {
            this.logger.warn(`[Vcs] Could not check point before closing the project: ${String(error)}`);
        }
    }

    /** Flush every open workspace concurrently. Used on the way out of the app. */
    public async flushAllWorkspacesPendingSaves(): Promise<void> {
        const workspaces = this.windowManager.getWindows().filter(
            (window): window is AppWindow<WindowAppType.Workspace> =>
                !window.isClosed() && window.getWindowType() === WindowAppType.Workspace,
        );
        await Promise.allSettled(workspaces.map(window => this.flushWorkspacePendingSaves(window)));
    }

    /**
     * Decide what closing a workspace means, honouring the user's preferences: confirm first if
     * asked, then either fall back to the launcher or let the close stand (which quits the app
     * when this was the last window).
     */
    private async handleWorkspaceCloseRequest(window: AppWindow<WindowAppType.Workspace>): Promise<void> {
        if (this.globalState.get("workspace.confirmBeforeClose")) {
            const confirmed = await this.confirmWorkspaceClose(window);
            if (!confirmed) {
                return;
            }
        }

        // Confirm first, flush second: asking the renderer to write while a modal is up would
        // block on a dialog, and a user who answers "don't close" should keep their timers running
        // rather than get a write they did not ask for.
        this.reportWorkspaceCloseStage(window, "saving");
        await this.flushWorkspacePendingSaves(window);

        // Flush first, check point second: the checkpoint's whole value is that it
        // records what is on disk, and the flush is what puts the last edit there.
        this.reportWorkspaceCloseStage(window, "checkpoint");
        await this.checkpointBeforeClose(window);

        // The app may have started quitting, or the window may be gone, while the sheet was up.
        // Reopening the launcher now would resurrect a window in the middle of a quit.
        if (this.isQuitting() || window.isClosed()) {
            return;
        }

        if (this.globalState.get("workspace.returnToLauncherOnClose")) {
            this.reportWorkspaceCloseStage(window, "launcher");
            try {
                await this.ensureLauncher();
            } catch (error) {
                // Closing now would take the app down with it - this was probably the last
                // window, and the home the user asked to return to is the thing that failed.
                // Keeping the workspace open loses nothing and leaves them somewhere to work.
                this.logger.error("[Workspace] Keeping the window open, the launcher failed to start:", error);
                // The window is staying, so the "closing" indicator has to go: leaving it up would
                // put a scrim over a workspace that is fully usable again.
                this.reportWorkspaceCloseStage(window, null);
                return;
            }
        }

        window.forceClose();
    }

    /**
     * Tell a workspace which part of its close is running now.
     *
     * Fire and forget by design. This is the window's own progress note; a window that has already
     * gone, or a renderer that never registered a handler, changes nothing about the close, so a
     * failure here must not surface as one.
     */
    private reportWorkspaceCloseStage(
        window: AppWindow<WindowAppType.Workspace>,
        stage: WorkspaceCloseStage | null,
    ): void {
        if (window.isClosed()) {
            return;
        }
        try {
            window.sendIpcEvent(IPCEventType.workspaceCloseProgress, { stage });
        } catch (error) {
            this.logger.warn(`[Workspace] Could not report the close stage: ${String(error)}`);
        }
    }

    async launchSettings(
        parent: AppWindow<WindowAppType.Launcher>,
        props: WindowProps[WindowAppType.Settings],
        options: Partial<Electron.BrowserWindowConstructorOptions> = {},
    ): Promise<AppWindow<WindowAppType.Settings>> {
        const config: WindowConfig<WindowAppType.Settings> = {
            windowType: WindowAppType.Settings,
            isolated: true,
            autoFocus: true,
            preload: this.getPreloadScript(),
            options: {
                parent: parent.win,
                frame: false,
                titleBarStyle: 'hidden',
                show: false,
                ...options,
            },
        };
        const window = new AppWindow<WindowAppType.Settings>(this, config, props);
        window.setTitle("Settings - NarraLeaf Studio");
        this.applyWindowIcon(window);
        window.showWhenReady();

        await window.loadFile(this.getAppEntry(WindowAppType.Settings));

        return window;
    }

    async launchWorkspace(
        parent: AppWindow<WindowAppType.Settings>,
        props: WindowProps[WindowAppType.Workspace],
        options: Partial<Electron.BrowserWindowConstructorOptions> = {},
    ): Promise<AppWindow<WindowAppType.Workspace>> {
        const config: WindowConfig<WindowAppType.Workspace> = {
            windowType: WindowAppType.Workspace,
            isolated: true,
            autoFocus: true,
            preload: this.getPreloadScript(),
            options: {
                minWidth: 800,
                minHeight: 500,
                width: 800,
                height: 500,
                center: true,
                x: undefined,
                y: undefined,
                frame: false,
                ...options,
            },
        };
        const window = new AppWindow<WindowAppType.Workspace>(this, config, props);
        window.setTitle("Workspace - NarraLeaf Studio");
        this.applyWindowIcon(window);

        // Closing a workspace means "leave this project", not "quit the app". The decision needs
        // to await a confirmation sheet and the launcher's window, so always take the close over
        // and re-issue it via forceClose() once settled.
        let closeRequestPending = false;
        window.setCloseGuard(() => {
            if (closeRequestPending) {
                // Closing again while the last request is still settling would stack up
                // confirmation sheets. The usual reason for the second attempt is that the
                // sheet is not where the user is looking, so bring it to them instead of
                // swallowing the click without a trace.
                window.focus();
                return true;
            }

            closeRequestPending = true;
            void this.handleWorkspaceCloseRequest(window)
                .catch(error => {
                    this.logger.error("Failed to handle workspace close request:", error);
                })
                .finally(() => {
                    closeRequestPending = false;
                });
            return true;
        });

        // Wired here rather than at the call site: openProject hands back an already-open window
        // unchanged when the project is one, and binding F12 there would stack a second toggle
        // onto that window every time the user re-opened the same project - two toggles per press
        // cancelling each other out.
        if (this.isDevMode()) {
            window.onKeyUp("F12", () => {
                window.toggleDevTools();
            });
        }

        await window.loadFile(this.getAppEntry(WindowAppType.Workspace));

        // Project is added to recently opened only when workspace successfully loads it (see WorkspaceContext)

        return window;
    }

    /**
     * Re-authorize file-system access to a project the user has opened before. macOS only hands a
     * sandboxed folder back through the security-scoped bookmark captured when it was first chosen,
     * so without this a project outside the app container would be unreadable. Session lifetime
     * keeps the folder accessible for the rest of the run rather than tying it to the opener window.
     *
     * Shared by the launcher's launch IPC ({@link WorkspaceLaunchHandler}) and the native "Open
     * Recent" menu, so both grant identical access before a workspace touches the files.
     */
    public authorizeRecentProjectAccess(opener: AppWindow, projectPath: string): void {
        const recentProject = this.globalState.recentlyOpened.list().find(project =>
            normalizeProjectPath(project.path) === normalizeProjectPath(projectPath),
        );
        if (recentProject?.securityScopedBookmark) {
            this.storageManager.grantFileSystemAccess(
                opener,
                projectPath,
                "readwrite",
                true,
                recentProject.securityScopedBookmark,
                "session",
            );
        }
    }

    /** The live workspace window for a project, if one already has it open. */
    public findWorkspaceForProject(projectPath: string): AppWindow<WindowAppType.Workspace> | undefined {
        const target = normalizeProjectPath(projectPath);
        return this.windowManager.getWindows().find(window =>
            window.getWindowType() === WindowAppType.Workspace
            && !window.isClosed()
            && normalizeProjectPath(window.getProps().projectPath) === target,
        ) as AppWindow<WindowAppType.Workspace> | undefined;
    }

    /**
     * Project opens still in flight, keyed by normalized path. A window only becomes findable once
     * it exists, so without this two clicks on the same project would both miss the lookup in
     * {@link openProject} and each open a window of their own - two windows editing one project's
     * files, saving over each other.
     */
    private readonly projectOpenings = new Map<string, Promise<AppWindow<WindowAppType.Workspace>>>();

    /**
     * Open a project: authorize its files, then focus the window that already has it open, or
     * launch a fresh one.
     *
     * Every path that opens a project goes through here - the launcher's recent list and folder
     * picker, the project wizard, the native "Open Recent" menu, and the title-bar switcher - so
     * "one project, one window" holds however the user got there.
     *
     * A project that is already open is *focused*, never opened a second time, so one project
     * stays one window whether the switch found it or launched it.
     *
     * `replaceOpener` is a switch rather than an "open alongside": the window the user came from is
     * retired once the project they asked for is on screen - whether that meant launching it or
     * focusing the window that already had it. Leaving the opener up in the second case is the same
     * bug as leaving it up in the first, seen from the other side: the author asked to go to another
     * project and got two windows either way.
     *
     * Retirement waits for the new window to report a *working* project - an error screen is "ready"
     * too, and trading a working workspace for a dead end is exactly the thing to avoid - and never
     * retires a window into itself (re-opening the project you are already in is a no-op, not a
     * close).
     *
     * The launcher is the exception to all of it: it is a home screen rather than somewhere work
     * happens, so it always steps aside once the project it was asked for is on screen.
     */
    public async openProject(
        opener: AppWindow,
        projectPath: string,
        options: { replaceOpener?: boolean } = {},
    ): Promise<AppWindow<WindowAppType.Workspace>> {
        this.authorizeRecentProjectAccess(opener, projectPath);

        const openerIsLauncher = opener.getWindowType() === WindowAppType.Launcher;
        // "Reuse this window" only means something for a workspace: the launcher retires either
        // way, and no other window type is a place a project could take over.
        const replaceOpener = Boolean(options.replaceOpener)
            && opener.getWindowType() === WindowAppType.Workspace;

        // forceClose() is deliberate wherever the opener is retired below: opening a project is
        // not a "close this workspace" gesture, so it must skip the close guard's confirm sheet
        // and return-to-launcher, which would otherwise interrupt the open or flash the home
        // window.
        //
        // Skipping the close guard also skips the work it does on the way out, so this repeats it:
        //   - the flush, because the auto-save is debounced, and forceClosing a workspace 300ms
        //     after the last keystroke lost exactly that keystroke (the comment that used to sit
        //     here said "changes auto-save, so nothing is lost");
        //   - the checkpoint, because after this the project has no window and nothing is watching
        //     its working tree. Switching is the ordinary way to leave a project, so a switch that
        //     skipped it would drop the session record every time - the one thing checkpointing on
        //     close exists to prevent.
        // Both are bounded and neither throws, and the window says which one it is waiting on
        // exactly as it would during a close.
        const retireOpener = async () => {
            if (opener.isClosed()) {
                return;
            }
            if (opener.getWindowType() === WindowAppType.Workspace) {
                const workspace = opener as AppWindow<WindowAppType.Workspace>;
                this.reportWorkspaceCloseStage(workspace, "saving");
                await this.flushWorkspacePendingSaves(workspace);
                this.reportWorkspaceCloseStage(workspace, "checkpoint");
                await this.checkpointBeforeClose(workspace);
            }
            if (!opener.isClosed()) {
                opener.forceClose();
            }
        };

        const existing = this.findWorkspaceForProject(projectPath);
        if (existing) {
            // A minimized window ignores focus() on macOS, so bring it back up first.
            if (existing.win.isMinimized()) {
                existing.win.restore();
            }
            existing.focus();
            // `existing !== opener` guards the one case that is not a switch at all: asking for the
            // project this window already holds (the File menu's recent list does not hide it), which
            // must focus the window rather than close it.
            if ((openerIsLauncher || replaceOpener) && existing !== opener) {
                await retireOpener();
            }
            return existing;
        }

        const key = normalizeProjectPath(projectPath);
        const pending = this.projectOpenings.get(key);
        const launch = pending ?? this.launchWorkspace(
            opener,
            { projectPath },
            { minWidth: 800, minHeight: 600, ...this.workspacePlacement(opener, replaceOpener) },
        );

        if (!pending) {
            this.projectOpenings.set(key, launch);
            void launch.catch(() => void 0).finally(() => {
                this.projectOpenings.delete(key);
            });
        }

        const workspaceWindow = await launch;

        if ((openerIsLauncher || replaceOpener) && workspaceWindow !== opener) {
            workspaceWindow.onLoadResult(ok => {
                if (ok) {
                    void retireOpener();
                }
            });
        }
        return workspaceWindow;
    }

    /**
     * Where a workspace window being launched should come up.
     *
     * A window replacing the one it was opened from takes over its frame exactly, so the switch
     * reads as the same window changing project rather than as one window closing and another
     * appearing somewhere else.
     *
     * A window opening *alongside* a workspace is stepped down and to the right of it instead, at
     * the same size. Same-sized and same-placed would put the new project exactly over the old one,
     * which is what a replacement looks like - the author would have no way to tell from the screen
     * that the window they came from is still there. The offset is dropped rather than pushing the
     * window off the display when there is no room for it (a maximized opener, most often), and the
     * default centred frame is used instead, which is distinct enough on its own.
     *
     * Everything else - the launcher above all, whose frame is nothing like a workspace's - gets
     * the default.
     */
    private workspacePlacement(
        opener: AppWindow,
        replaceOpener: boolean,
    ): Partial<Electron.BrowserWindowConstructorOptions> {
        const fallback = { width: 1400, height: 900, center: true };
        if (opener.getWindowType() !== WindowAppType.Workspace || opener.isClosed()) {
            return fallback;
        }

        const bounds = opener.win.getBounds();
        if (replaceOpener) {
            return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, center: false };
        }

        const { workArea } = screen.getDisplayMatching(bounds);
        const x = bounds.x + WINDOW_CASCADE_STEP;
        const y = bounds.y + WINDOW_CASCADE_STEP;
        const fits = x >= workArea.x
            && y >= workArea.y
            && x + bounds.width <= workArea.x + workArea.width
            && y + bounds.height <= workArea.y + workArea.height;

        return fits
            ? { x, y, width: bounds.width, height: bounds.height, center: false }
            : fallback;
    }

    async launchProjectWizard(
        parent: AppWindow<WindowAppType.Launcher>,
        props: WindowProps[WindowAppType.ProjectWizard],
        options: Partial<Electron.BrowserWindowConstructorOptions> = {},
    ): Promise<AppWindow<WindowAppType.ProjectWizard>> {
        const config: WindowConfig<WindowAppType.ProjectWizard> = {
            windowType: WindowAppType.ProjectWizard,
            isolated: true,
            autoFocus: true,
            preload: this.getPreloadScript(),
            options: {
                parent: parent.win,
                show: false,
                frame: false,
                titleBarStyle: 'hidden',
                ...options,
            },
        };
        const window = new AppWindow(this, config, props);
        window.setTitle("Project Wizard - NarraLeaf Studio");
        this.applyWindowIcon(window);
        window.showWhenReady();

        await window.loadFile(this.getAppEntry(WindowAppType.ProjectWizard));

        return window;
    }

    async launchDevMode(
        props: WindowProps[WindowAppType.DevMode],
        options: Partial<Electron.BrowserWindowConstructorOptions> = {},
    ): Promise<AppWindow<WindowAppType.DevMode>> {
        const config: WindowConfig<WindowAppType.DevMode> = {
            windowType: WindowAppType.DevMode,
            isolated: true,
            autoFocus: true,
            preload: this.getPreloadScript(),
            options: {
                minWidth: 900,
                minHeight: 600,
                width: 1400,
                height: 900,
                center: true,
                frame: false,
                titleBarStyle: "hidden",
                backgroundColor: getGameHostWindowBackgroundColor(),
                show: false,
                ...options,
            },
        };
        const window = new AppWindow<WindowAppType.DevMode>(this, config, props);
        window.setTitle("Dev Mode - NarraLeaf Studio");
        this.applyWindowIcon(window);

        // Confine the preview renderer to the app protocol unless the project
        // opts into HTTP. Must be applied BEFORE loadFile so the initial
        // document load and every subsequent game request is governed.
        const allowHttp = await readProjectAllowHttp(props.projectPath);
        const previewWebContentsId = window.win.webContents.id;
        devModeNetworkPolicy.apply(previewWebContentsId, { allowHttp });
        window.onClose(() => devModeNetworkPolicy.release(previewWebContentsId));

        try {
            await window.loadFile(this.getAppEntry(WindowAppType.DevMode));
        } catch (error: any) {
            if (error && (error.code === "ERR_ABORTED" || error.errno === -3)) {
                this.logger.warn("[DevMode] Initial navigation aborted by reload, continuing...");
            } else {
                throw error;
            }
        }

        // Do not rely only on renderer `appWindowReady` + showWhenReady: if the renderer never
        // announces ready (crash, IPC timing, aborted load), the window would stay hidden while
        // DevModeManager still reports running. Show as soon as main navigation completes.
        await window.show();
        window.win.focus();

        window.onKeyUp("F12", () => {
            window.toggleDevTools();
        });

        return window;
    }

    async launchPluginPermissionPrompt(
        parent: AppWindow,
        props: WindowProps[WindowAppType.PluginPermissionPrompt],
        options: Partial<Electron.BrowserWindowConstructorOptions> = {},
    ): Promise<AppWindow<WindowAppType.PluginPermissionPrompt>> {
        const config: WindowConfig<WindowAppType.PluginPermissionPrompt> = {
            windowType: WindowAppType.PluginPermissionPrompt,
            isolated: true,
            autoFocus: true,
            preload: this.getPreloadScript(),
            windowControlPolicy: WindowControlPolicy.None,
            options: {
                modal: true,
                parent: parent.win,
                resizable: false,
                minimizable: false,
                maximizable: false,
                closable: true,
                fullscreenable: false,
                width: 520,
                height: 380,
                center: true,
                frame: false,
                titleBarStyle: "hidden",
                show: false,
                ...options,
            },
        };
        const promptProps: WindowProps[WindowAppType.PluginPermissionPrompt] = {
            ...props,
            requester: {
                windowType: parent.getWindowType(),
                title: parent.getTitle(),
            },
        };
        const window = new AppWindow<WindowAppType.PluginPermissionPrompt>(this, config, promptProps);
        window.setTitle("Plugin Permission - NarraLeaf Studio");
        this.applyWindowIcon(window);
        window.showWhenReady();

        await window.loadFile(this.getAppEntry(WindowAppType.PluginPermissionPrompt));

        return window;
    }
}
