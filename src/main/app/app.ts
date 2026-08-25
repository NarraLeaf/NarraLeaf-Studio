import fs from "fs";
import path from "path";
import { screen, session } from "electron";
import {
    QUIT_CHECKPOINT_TIMEOUT_DEFAULT_SECONDS,
    QUIT_CHECKPOINT_TIMEOUT_KEY,
    QUIT_CHECKPOINT_TIMEOUT_MAX_SECONDS,
    QUIT_CHECKPOINT_TIMEOUT_MIN_SECONDS,
} from "@shared/constants/quit";
import { IPCEventType, WorkspaceCloseStage } from "@shared/types/ipcEvents";
import { WindowAppType, WindowControlPolicy, WindowProps } from "@shared/types/window";
import { BaseApp, BaseAppConfig } from "./application/baseApp";
import { getGameHostWindowBackgroundColor } from "./application/theme";
import { AppWindow, WindowConfig } from "./application/managers/window/appWindow";
import { DevModeManager } from "./application/managers/devMode/DevModeManager";
import { devModeNetworkPolicy, readProjectNetworkSettings } from "./application/managers/devMode/devModeNetworkPolicy";
import { GameBuildManager } from "./application/managers/build/GameBuildManager";
import { GameTestManager } from "./application/managers/gameTest/GameTestManager";
import { MediaConvertManager } from "./application/managers/media/MediaConvertManager";
import { StudioTaskScheduler } from "./application/managers/tasks/StudioTaskScheduler";
import { WeatherBakeManager } from "./application/managers/weather/WeatherBakeManager";
import { PreviewManager } from "./application/managers/preview/PreviewManager";
import { VcsManager } from "./application/managers/vcs/VcsManager";
import { TeamManager } from "./application/managers/team/TeamManager";
// Shared with the recently-opened history, which must agree with the "already open?" lookup here.
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { findProjectConfigFileName } from "@shared/utils/nlproj";
import {
    LaunchOpenLookup,
    LaunchOpenRequest,
    resolveFirstLaunchOpenRequest,
} from "./application/launchOpenRequest";
import { ONBOARDING_STATE_KEY, needsOnboarding } from "@shared/constants/onboarding";
import { LAUNCHER_HOME_SIZE, LAUNCHER_ONBOARDING_SIZE } from "./application/launcherWindow";
import { TRAY_RESIDENCY_NOTICE_KEY, UPDATE_PANEL_SETTING_KEY } from "@shared/constants/update";
import { getMainTranslator } from "./application/i18n";
import { ConfirmQuitManager } from "./application/managers/confirmQuit";
import { TrayManager } from "./application/managers/trayManager";
import { UpdateManager } from "./application/managers/updateManager";
import { SpellcheckManager } from "./application/managers/spellcheck/spellcheckManager";
import { SPELLCHECK_LANGUAGE_KEY } from "@shared/types/spellcheck";
import { resolveStartupProject } from "./application/startupProject";
import { CommandLineBuildRun } from "./application/commandLineBuild";
import { DeferredWindowShow, createDeferredWindowShow } from "./application/deferredWindowShow";
import { handOverWorkspace } from "./application/workspaceHandOver";
import { decideReopenAction } from "./application/reopenAction";

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
 * What {@link App.drainForShutdown} is allowed on top of the checkpoint budget before the exit
 * goes ahead without it.
 *
 * The deadline is a sum rather than one fixed number, and that is what makes the checkpoint budget
 * safe to configure: raising `versionControl.quitCheckpointTimeoutSeconds` buys the checkpoints
 * more time instead of taking it from the stores, and a version-control call still in flight when
 * Node destroys the environment aborts the process. With the default budget the total is the
 * twenty seconds a quit was allowed before any of it was configurable.
 *
 * Generous, because everything it is waiting on is work that would otherwise be lost. Bounded,
 * because both callers are exits: a Cmd+Q that hangs on a network fetch, and a build job that never
 * returns an exit code, are worse outcomes than losing the last few seconds.
 */
const SHUTDOWN_BASE_DEADLINE_MS = 10_000;

/**
 * How far a workspace opening beside another one is stepped from it, so the new window is visibly
 * a second window rather than the same frame with different contents.
 */
const WINDOW_CASCADE_STEP = 32;

/**
 * How long a workspace being replaced waits for its replacement to report a project, before it
 * stops waiting and both windows are simply left on screen.
 *
 * The wait is what keeps the switch to one window at a time, and it is bounded because the thing
 * being waited on is a renderer: one that died before its preflight settled, or hung in it, would
 * otherwise leave the author holding a workspace under a scrim with nothing on the way. Generous,
 * because a large project on a cold disk legitimately takes seconds and the only cost of waiting a
 * moment longer is a moment.
 */
const REPLACEMENT_HANDOVER_TIMEOUT_MS = 30_000;

/** How a launcher window is to be brought up. See `App.holdLauncherBack`. */
interface LauncherStartupOptions {
    /**
     * Build the window but leave it off screen, for a launch that expects to open a project from
     * it. Only the startup asks for this, and only it can: every other caller is a request to see
     * the home screen.
     */
    deferShow?: boolean;
}

/**
 * Why a workspace is going away.
 *
 * `"close"` is the window's own close box, Cmd+W and Quit: the window ends and nothing takes its
 * place, so the app quits or goes resident exactly as it would with any other last window.
 * `"launcher"` is File ▸ Back to Launcher: the author is not leaving Studio, they are leaving this
 * project, so the home screen is up before this window goes.
 *
 * These were one path with a preference choosing between them, which made "quit when I close a
 * project" and "let me go back to the home screen" mutually exclusive when they are not the same
 * question. See `handleWorkspaceExitRequest`.
 */
export type WorkspaceExitIntent = "close" | "launcher";

/** How {@link App.openProject} is being asked to open a project. */
export type OpenProjectOptions = {
    /** Retire the window this was opened from once the project is up. See {@link App.openProject}. */
    replaceOpener?: boolean;
    /**
     * Open the project with nothing on screen.
     *
     * Two consequences, and both are the point: the workspace window is created hidden and never
     * focused, and a project that fails to load does not reveal the home screen it was opened from.
     * Only `--build` passes it - see `commandLineBuild.ts` for why an entry point with no interface
     * has to say both of those things rather than one.
     */
    background?: boolean;
    /**
     * Run this build in the workspace instead of opening the editor; carried into the window's
     * props. See `WindowProps[WindowAppType.Workspace].commandLineBuild`.
     */
    commandLineBuild?: WindowProps[WindowAppType.Workspace]["commandLineBuild"];
};

/**
 * `candidate` as an absolute path if it names a directory, otherwise null.
 *
 * Relative paths resolve against the working directory, which is what a `--project .` typed in a
 * project folder means. A path that cannot be looked at (a disconnected drive, a permission error)
 * is "not a directory" here: the point is only to tell a path apart from a project *name*, and a
 * string that looks like a path is not a name either way.
 */
function resolveExistingDirectory(candidate: string): string | null {
    try {
        const absolute = path.resolve(candidate);
        return fs.statSync(absolute).isDirectory() ? absolute : null;
    } catch {
        return null;
    }
}

/**
 * `candidate` as an absolute path if it names a file. The file half of
 * {@link resolveExistingDirectory}, and unreadable is "not a file" for the same reason.
 */
function resolveExistingFile(candidate: string, base?: string): string | null {
    try {
        const absolute = base ? path.resolve(base, candidate) : path.resolve(candidate);
        return fs.statSync(absolute).isFile() ? absolute : null;
    } catch {
        return null;
    }
}

/**
 * Whether `directory` holds a project config, without reading it.
 *
 * Synchronous because it answers a launch, which has to decide what window to open before it opens
 * one - and because it reads one directory listing. A directory that cannot be listed is not a
 * project here, which is the same answer as an empty one and the right one either way.
 */
function directoryHoldsProject(directory: string): boolean {
    try {
        return findProjectConfigFileName(fs.readdirSync(directory, { withFileTypes: true }).map(entry => ({
            name: path.parse(entry.name).name,
            ext: path.extname(entry.name) || null,
            type: entry.isDirectory() ? "directory" : "file",
        }))) !== null;
    } catch {
        return false;
    }
}

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
        this.taskScheduler = new StudioTaskScheduler();
        this.weatherBakeManager = new WeatherBakeManager(this, this.taskScheduler);
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

        // A server is now a place Studio holds a session with, and that is a thing of
        // its own rather than a corner of version control. It is given the list of
        // servers rather than the manager that keeps it: what it needs is an address and
        // a name, and a session has nothing to do with a repository.
        this.teamManager = new TeamManager(this, () => this.vcsManager.listServers());

        this.updateManager = new UpdateManager(this);
        this.confirmQuitManager = new ConfirmQuitManager(this);
        // Everything is read through a function rather than captured: this constructor runs before
        // Electron is ready, and `getUserDataDir` has no answer until it is.
        this.spellcheckManager = new SpellcheckManager({
            userDataDir: () => this.getUserDataDir(),
            readSetting: () => this.globalState.get(SPELLCHECK_LANGUAGE_KEY),
        });

        // Built as soon as there is an Electron app to attach it to, because from here on it is
        // the only handle a windowless Studio has - see handleLastWindowClosed, which reads
        // `isActive()` and refuses to go resident without it. macOS is excluded inside
        // TrayManager and keeps the Dock instead.
        //
        // The tray comes first: the updater rebuilds the tray menu on every state change, and
        // its launch check is scheduled by `initialize()`.
        this.onReady(() => {
            const tray = new TrayManager(this, {
                openLauncher: () => this.revealLauncher(),
                openUpdateSettings: () => this.revealSettings({ highlight: UPDATE_PANEL_SETTING_KEY }),
            });
            tray.initialize();
            this.trayManager = tray;

            this.updateManager.initialize();

            // After ready, because it listens for webContents being created and the first window is
            // opened from the same ready handler in `index.ts`. Ordering only matters in that
            // direction: a window built before the listener exists would never see a ⌘Q at all.
            this.confirmQuitManager.initialize();
        });
    }

    private readonly devModeManager: DevModeManager;
    private readonly previewManager: PreviewManager;
    private readonly gameTestManager: GameTestManager;
    private readonly gameBuildManager: GameBuildManager;
    private readonly mediaConvertManager: MediaConvertManager;
    private readonly taskScheduler: StudioTaskScheduler;
    private readonly weatherBakeManager: WeatherBakeManager;
    private readonly vcsManager: VcsManager;
    private readonly teamManager: TeamManager;
    private readonly updateManager: UpdateManager;
    private readonly confirmQuitManager: ConfirmQuitManager;
    private readonly spellcheckManager: SpellcheckManager;

    /** Studio's own spellchecker: the downloaded dictionaries, and each window's project words. */
    public getSpellcheckManager(): SpellcheckManager {
        return this.spellcheckManager;
    }

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

    /**
     * The one queue Studio's long work goes through.
     *
     * App-wide rather than per-window: the work belongs to the machine, not to whichever window
     * happened to ask for it, and two windows onto the same project must not bake the same clip
     * twice.
     */
    public getTaskScheduler(): StudioTaskScheduler {
        return this.taskScheduler;
    }

    /** Produces the clips weather seeds describe, and finds the ones already made. */
    public getWeatherBakeManager(): WeatherBakeManager {
        return this.weatherBakeManager;
    }

    public getVcsManager(): VcsManager {
        return this.vcsManager;
    }

    /**
     * The sessions Studio holds with Team servers.
     *
     * Separate from {@link getVcsManager} on purpose. Version control is what Studio does
     * with a repository; this is what it does with a server, and the two stopped being
     * the same question the moment a server could be asked something that is not about a
     * repository at all.
     */
    public getTeamManager(): TeamManager {
        return this.teamManager;
    }

    /** Everything Studio knows about newer versions of itself. See {@link UpdateManager}. */
    public getUpdateManager(): UpdateManager {
        return this.updateManager;
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
        // Skipping records nothing, so this is only ever "not on this launch" - the profile still
        // owes the setup flow, and the next launch without the flag will ask for it.
        if (this.wantsOnboardingSkipped()) {
            return false;
        }
        return needsOnboarding(this.globalState.get(ONBOARDING_STATE_KEY));
    }

    async launchLauncher(
        options: Partial<Electron.BrowserWindowConstructorOptions>,
        { deferShow = false }: LauncherStartupOptions = {},
    ): Promise<AppWindow<WindowAppType.Launcher>> {
        // Asked once, and used twice: it decides the window's size as well as the mode the
        // renderer opens in, so setup gets its room from the first frame rather than growing the
        // window under the author a moment after it appears.
        const onboarding = this.shouldRunOnboarding();
        const size = onboarding ? LAUNCHER_ONBOARDING_SIZE : LAUNCHER_HOME_SIZE;
        const config: WindowConfig<WindowAppType.Launcher> = {
            windowType: WindowAppType.Launcher,
            isolated: true,
            autoFocus: true,
            preload: this.getPreloadScript(),
            windowControlPolicy: WindowControlPolicy.MacNativeOutsideTitleBar,
            options: {
                minWidth: size.width,
                minHeight: size.height,
                maxWidth: size.width,
                maxHeight: size.height,
                width: size.width,
                height: size.height,
                frame: false,
                resizable: false,
                maximizable: false,
                titleBarStyle: 'hidden',
                show: false,
                ...options,
            },
        };
        const window = new AppWindow<WindowAppType.Launcher>(this, config, {
            onboarding,
        });
        window.setTitle("Launcher - NarraLeaf Studio");
        this.applyWindowIcon(window);
        if (deferShow) {
            this.holdLauncherBack(window);
        } else {
            window.showWhenReady();
        }

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

    /** The open launcher window, if the user still has a home to fall back to. */
    private findLauncher(): AppWindow<WindowAppType.Launcher> | undefined {
        return this.windowManager.getWindows().find(window =>
            !window.isClosed() && window.getWindowType() === WindowAppType.Launcher
        ) as AppWindow<WindowAppType.Launcher> | undefined;
    }

    /**
     * The launcher, for a caller outside this class that has just built one and needs to open a
     * project from it - which is `--build` and nothing else. See {@link CommandLineBuildRun}.
     */
    public findLauncherWindow(): AppWindow<WindowAppType.Launcher> | undefined {
        return this.findLauncher();
    }

    /** True while a launcher window is open, i.e. the user still has a home to fall back to. */
    hasAliveLauncher(): boolean {
        return this.findLauncher() !== undefined;
    }

    /** In-flight launcher startup, shared by concurrent callers. See {@link ensureLauncher}. */
    private launcherStartup: Promise<void> | null = null;

    /**
     * The launcher that was built without being put on screen, until something reveals it.
     *
     * Null whenever there is no such window - which is every launch that starts on the home screen,
     * and every moment after a held-back one was either revealed or retired.
     */
    private heldBackLauncher: DeferredWindowShow | null = null;

    /**
     * Build the launcher without putting it on screen, and hold on to the way to change our mind.
     *
     * A launch that is going to land in a project still opens the launcher first - the project is
     * opened *from* it, which is how a startup inherits every failure path the home screen has -
     * but showing it means the author watches their home screen appear and disappear on the way to
     * the project they asked for. Held back, the same chain runs with nothing on screen until the
     * workspace itself is up.
     *
     * The latch and the reason it has to be one are in {@link createDeferredWindowShow}.
     */
    private holdLauncherBack(window: AppWindow<WindowAppType.Launcher>): void {
        const held = createDeferredWindowShow({
            isClosed: () => window.isClosed(),
            show: () => void window.show(),
        });
        this.heldBackLauncher = held;
        window.onReady(() => held.markReady());

        // A held-back launcher that was retired has nothing left to reveal, and leaving it here
        // would make every later `revealHeldBackLauncher` a no-op on a dead window rather than
        // whatever the caller does when there is no launcher at all.
        window.onEvent("closed", () => {
            if (this.heldBackLauncher === held) {
                this.heldBackLauncher = null;
            }
        });
    }

    /**
     * Put a launcher that was held back on screen. Does nothing when none is.
     *
     * Every way back to the home screen goes through this, because to `focus()` a hidden window is
     * indistinguishable from no window at all - while `hasAliveLauncher` already counts it as the
     * home everything else falls back to.
     */
    private revealHeldBackLauncher(): void {
        const held = this.heldBackLauncher;
        this.heldBackLauncher = null;
        held?.reveal();
    }

    /**
     * Show the held-back launcher if it is the only thing left alive.
     *
     * The backstop for a startup whose project never got as far as reporting an outcome - a
     * renderer that crashed on load, a window terminated by its own error handling. The workspace
     * is gone, the home screen behind it was never shown, and an app whose only window is hidden
     * is an app that looks like it died on launch.
     *
     * Called from the `window-closed` handler, where the window that is going away has usually not
     * been unregistered yet - hence `!isClosed()` rather than a count.
     */
    public revealLauncherIfNothingElseIsUp(): void {
        // Windows going away is what a quit looks like from here. Raising the home screen in the
        // middle of one would put a window on screen on the way out.
        if (!this.heldBackLauncher || this.isQuitting()) {
            return;
        }
        const somethingElseIsUp = this.windowManager.getWindows().some(window =>
            !window.isClosed() && window.getWindowType() !== WindowAppType.Launcher
        );
        if (!somethingElseIsUp) {
            this.revealHeldBackLauncher();
        }
    }

    /**
     * Bring back the launcher, unless one is already open. Resolves once its window exists, so
     * callers can close whatever they are leaving without the app ever running windowless.
     *
     * Concurrent callers share one startup: `hasAliveLauncher` only turns true once the window
     * has been built, so two workspaces closing at the same time would otherwise each open a
     * launcher of their own.
     *
     * `deferShow` is the startup's business alone (see {@link holdLauncherBack}). Every other
     * caller wants the home screen *seen*, so they also reveal one that is being held back - a
     * launcher exists either way, and without this they would return happily having shown nothing.
     */
    async ensureLauncher({ deferShow = false }: LauncherStartupOptions = {}): Promise<void> {
        if (this.hasAliveLauncher()) {
            if (!deferShow) {
                this.revealHeldBackLauncher();
            }
            return;
        }
        if (this.launcherStartup) {
            const startup = this.launcherStartup;
            return deferShow ? startup : startup.then(() => this.revealHeldBackLauncher());
        }

        this.launcherStartup = this.launchLauncher({}, { deferShow }).then(launcher => {
            launcher.onKeyUp("F12", () => {
                launcher.toggleDevTools();
            });
        }).finally(() => {
            this.launcherStartup = null;
        });

        return this.launcherStartup;
    }

    /**
     * macOS: the Dock icon was clicked, or Studio was otherwise reopened while already running.
     *
     * The rule, and why it is not simply "show the home screen", is in `decideReopenAction`. All
     * this adds is the reading of the windows it decides from, and the raising of the most recently
     * opened one when the reopen brought nothing forward by itself.
     */
    public handleReopen(hasVisibleWindows: boolean): void {
        const onScreen = this.windowManager.getWindows()
            .filter(window => !window.isClosed() && (window.win.isVisible() || window.win.isMinimized()));
        const action = decideReopenAction({ hasVisibleWindows, windowsOnScreen: onScreen.length });

        if (action === "launcher") {
            void this.revealLauncher();
            return;
        }
        if (action === "raise") {
            const front = onScreen[onScreen.length - 1];
            if (front.win.isMinimized()) {
                front.win.restore();
            }
            front.focus();
        }
    }

    /**
     * Bring the home screen in front of the user, opening it if they closed everything.
     *
     * The entry point for every "get me back into Studio" gesture now that closing the last
     * window no longer ends the session: the tray item and its Open Launcher row, a second launch
     * handing its intent to the running instance, and a macOS reopen that found nothing to come
     * back to (see {@link handleReopen}).
     *
     * Restores before focusing because a minimized window is the common case for the tray - and
     * `focus()` alone leaves a minimized window minimized.
     */
    public async revealLauncher(): Promise<void> {
        const existing = this.findLauncher();
        if (existing) {
            // It may be one that was held back for a project that never came up - hidden, and so
            // deaf to focus(). Asking for the home screen is the plainest way of changing our mind
            // about that.
            this.revealHeldBackLauncher();
            if (existing.win.isMinimized()) {
                existing.win.restore();
            }
            existing.focus();
            return;
        }
        await this.ensureLauncher();
        this.findLauncher()?.focus();
    }

    /**
     * Open Settings on a particular entry - or move the open Settings window to it.
     *
     * The one way a Settings window comes into being: the IPC handler renderers use, the tray's
     * Check for Updates row and macOS's Cmd+, all arrive here, because "open settings at X" has to
     * be idempotent from every one of them - launching unconditionally would leave two Settings
     * windows disagreeing about what is selected.
     *
     * **Settings belongs to the app, not to whoever opened it, and is therefore a top-level
     * window.** It used to be constructed with the opening window as its Electron `parent`, which
     * made Chromium destroy it whenever that window went away: closing one of two open projects,
     * or the launcher retiring itself the moment a project opened, silently took Settings with it
     * while the rest of Studio carried on. Its contents are global - there is nothing about it that
     * belongs to one project - so nothing was gained by the link either.
     *
     * `opener` is kept only as the answer to "which display should this come up on"; a Settings
     * window opened from the tray with no window in sight is a perfectly good outcome and no longer
     * has to raise a launcher first to have something to hang from.
     */
    public async revealSettings(
        props: WindowProps[WindowAppType.Settings],
        opener?: AppWindow,
    ): Promise<void> {
        const existing = this.windowManager.getWindows()
            .find(candidate => !candidate.isClosed() && candidate.getWindowType() === WindowAppType.Settings);
        if (existing) {
            if (props?.highlight) {
                existing.sendIpcEvent(IPCEventType.settingsHighlight, { highlight: props.highlight });
            }
            if (existing.win.isMinimized()) {
                existing.win.restore();
            }
            existing.focus();
            return;
        }

        await this.launchSettings(props, {
            minWidth: 800,
            minHeight: 500,
            width: 1200,
            height: 800,
            center: true,
            x: undefined,
            y: undefined,
            ...this.displayPlacement(opener, 1200, 800),
        });
    }

    /**
     * Centre a window of `width` x `height` on the display `opener` is on.
     *
     * `center: true` centres on the *primary* display, so a Studio being used on a second monitor
     * would put every window it raises back on the first one. Nothing to do when there is no opener
     * to follow: the primary display is the only answer left, and it is the right one.
     */
    private displayPlacement(
        opener: AppWindow | undefined,
        width: number,
        height: number,
    ): Partial<Electron.BrowserWindowConstructorOptions> {
        if (!opener || opener.isClosed()) {
            return {};
        }
        const { workArea } = screen.getDisplayMatching(opener.win.getBounds());
        return {
            x: Math.round(workArea.x + (workArea.width - width) / 2),
            y: Math.round(workArea.y + (workArea.height - height) / 2),
            center: false,
        };
    }

    /**
     * What happens when the user closes the last window.
     *
     * Studio used to quit here. It now stays resident, because an update that is still
     * downloading has to be allowed to finish, and because closing a project is not the same
     * gesture as quitting the editor.
     *
     * The exception is the one that matters: on Windows and Linux, residency without a status-bar
     * item leaves a process with no handle at all - not in the taskbar, not in the tray, ending
     * only from Task Manager. A tray that failed to appear (no StatusNotifier host on Linux, a
     * missing icon resource) therefore falls back to the old behaviour rather than stranding it.
     * macOS always has the Dock, so it never needs the fallback.
     *
     * A quit gets here too, and must not be treated as this gesture: the windows a quit closes on
     * its way out arrive at the same listener, with the tray still up and `hasWindows()` already
     * false. Electron's own `window-all-closed` is silent during a quit for exactly this reason
     * (`Browser::OnWindowAllClosed` shuts down instead of emitting), but the window event this
     * runs on is Studio's, so the distinction has to be made here.
     */
    public handleLastWindowClosed(): void {
        if (process.platform === "darwin") {
            return;
        }
        // Closing the last window on the way out of a quit is not "the user closed the last
        // window". Announcing residency there says the opposite of what is happening - and, being
        // a once-per-profile notice, it spends itself on the one moment it cannot be true, so the
        // first real residency is then the silent one.
        if (this.isQuitting()) {
            return;
        }
        if (this.trayManager?.isActive()) {
            this.announceResidencyOnce();
            return;
        }
        this.logger.warn("[App] No window and no status-bar item; quitting rather than going headless.");
        this.quit();
    }

    /**
     * Tell the user where Studio went, the first time it goes resident on this machine.
     *
     * Once per profile, because it is an explanation rather than a status: after the first time,
     * the tray item is somewhere they have already been shown. Recorded before the balloon is
     * shown - a balloon that failed to appear is not worth repeating the notice forever over, and
     * `displayBalloon` reports nothing either way.
     */
    private announceResidencyOnce(): void {
        if (this.globalState.get(TRAY_RESIDENCY_NOTICE_KEY) === true) {
            return;
        }
        this.setGlobalStateAndBroadcast(TRAY_RESIDENCY_NOTICE_KEY, true);
        const { t } = getMainTranslator(this);
        this.trayManager?.announceResidency(
            t("menu.tray.residencyNotice.title"),
            t("menu.tray.residencyNotice.body"),
        );
    }

    /**
     * The project this launch should open by itself, or null to sit on the home screen.
     *
     * `--project` wins outright - it names a project, and naming one is more specific than the
     * standing preference to carry on where the last session left off. Everything else is that
     * preference: the head of the history, which is the project the author was last in.
     *
     * Three things deliberately suppress the reopen, all of them cases where the author is not
     * asking to be put back to work:
     *   - `--launcher`, the escape hatch. A project that hangs or crashes the workspace on load
     *     would otherwise be reopened by every launch, and the home screen - the one place to open
     *     a *different* project from - would be unreachable. Not dev-gated, for that reason: the
     *     launch that needs it most is a packaged one.
     *   - first-run setup still owed, which is a question to answer rather than a project to be
     *     dropped into.
     *   - an empty history, which is every genuinely first launch.
     */
    private resolveSessionStartupProject(): { projectPath: string; source: "path" | "recent" | "last-session" } | null {
        const selectorError = this.getStartupProjectError();
        if (selectorError) {
            this.logger.warn(`[Startup] ${selectorError}`);
        }

        const selector = this.getStartupProjectSelector();
        if (selector) {
            const resolution = resolveStartupProject(selector, {
                resolveDirectory: candidate => resolveExistingDirectory(candidate),
                recentProjects: () => this.globalState.recentlyOpened.list(),
            });
            if (!resolution.ok) {
                this.logger.warn(`[Startup] ${resolution.reason}. Opening the launcher instead.`);
                return null;
            }
            return { projectPath: resolution.projectPath, source: resolution.source };
        }

        if (this.wantsLauncherOnStartup()) {
            this.logger.info("[Startup] --launcher was given; staying on the home screen.");
            return null;
        }
        if (!this.globalState.get("workspace.reopenLastProject")) {
            return null;
        }
        if (this.shouldRunOnboarding()) {
            return null;
        }

        // The history is most-recent-first, so its head is where the author was. Deliberately not
        // checked against the disk here: the workspace's own load is what knows whether a project
        // is openable, and a failed one already lands on an error screen with the launcher still
        // behind it. A stat() here would catch only the easiest case and would have to guess at
        // the rest.
        const last = this.globalState.recentlyOpened.list()[0];
        if (!last) {
            return null;
        }
        return { projectPath: last.path, source: "last-session" };
    }

    /**
     * The window this session starts on: the project asked for or carried over, or the launcher.
     *
     * The launcher is opened either way, and the project is then opened *from* it - the same call
     * a click on the recent list makes, so a startup inherits the whole of it: the
     * one-project-one-window lookup, the macOS bookmark re-authorization, the recents entry the
     * workspace writes once it has actually loaded, and the launcher retiring itself only after
     * the workspace reports a working project. Every way this can fail therefore lands on the home
     * screen with a line in the log, rather than on a windowless app or a dead end.
     *
     * It is opened *hidden* when a project is what this launch is for, which is why the decision is
     * made before the window is built rather than after. The chain above is unchanged - the
     * launcher is still there to be opened from, still there to fall back to, and still retires
     * itself when the workspace comes up - but a startup that lands in a project no longer shows
     * the home screen for the second it takes to get there. Every path that ends anywhere other
     * than in a loaded workspace reveals it again; see {@link revealHeldBackLauncher}.
     *
     * That last part is what keeps the reopen from being a way to lose the app: a project deleted,
     * moved or corrupted since is not a failed launch, it is a home screen with a message - and the
     * author is one click from opening something else.
     *
     * Restores one project, never a set. Studio opens one window per project, so a session that
     * ended with three of them open comes back as the one at the head of the history; nothing
     * records which windows were up when the last one went. That is the shape of the preference,
     * not a gap in this method - see `workspace.reopenLastProject`, which is off by default.
     */
    /**
     * Put this profile down: the saves, the game processes, the checkpoints, then version control.
     *
     * One list, because there are two exits that need it. The quit path holds `before-quit` open
     * while this runs; a command-line build cannot use that path at all, because carrying an exit
     * code means `exit()`, which skips `before-quit` entirely. Two copies of the list would drift,
     * and the way they would drift is that the exit nobody watches stops doing one of the four.
     *
     * Order is load-bearing and none of the four may skip another. The saves are debounced, so a
     * process ending 300ms after the last write loses exactly that write. The runtimes are separate
     * processes that macOS and Linux reparent rather than reap. The checkpoint has to see a flushed
     * tree and a store that is still open, which is what puts it third: ahead of version control
     * closing, and behind the process kills so that a long commit cannot leave a game running with
     * nothing left to stop it from. And every version-control call is a koffi `async` call
     * delivered by calling back into JS - one still in flight when Node destroys the environment
     * aborts the process, which is how a clean-looking exit produces a crash report.
     *
     * Nothing here throws: a failed flush is still an exit that has to close what it started. And
     * nothing here waits forever - the deadline is a bounded exit, not a safe one, but the
     * alternative is an app that cannot be quit and a build job that never returns.
     */
    public async drainForShutdown(): Promise<void> {
        // Read once, so the deadline and the step it is bounding cannot disagree - a Settings
        // change landing between the two would otherwise produce a drain whose parts do not add up.
        const checkpointBudgetMs = this.resolveQuitCheckpointTimeoutMs();
        const deadlineMs = SHUTDOWN_BASE_DEADLINE_MS + checkpointBudgetMs;
        const teardown = (async () => {
            await this.flushAllWorkspacesPendingSaves().catch(error => {
                this.logger.warn('Failed to flush pending saves before quit:', error);
            });
            await this.stopAllProjectRuntimes().catch(error => {
                this.logger.warn('Failed to stop the running game processes before quit:', error);
            });
            await this.checkpointOpenWorkspacesForShutdown(checkpointBudgetMs).catch(error => {
                this.logger.warn('Failed to check point the open projects before quit:', error);
            });
            await this.getVcsManager().dispose().catch(error => {
                this.logger.warn('Failed to close version control before quit:', error);
            });
        })();
        const deadline = new Promise<void>(resolve => setTimeout(resolve, deadlineMs));
        await Promise.race([teardown, deadline]);
        // Expiring here means ending with Lore work still running, which is exactly the abort the
        // drain exists to avoid. Nothing better is available - the alternative is a quit that hangs
        // on a network fetch - but it must not go unrecorded, because the crash report it produces
        // names koffi and says nothing about why the call was still open.
        if (this.getVcsManager().busy) {
            this.logger.warn(
                `Shutting down with version control still busy after ${deadlineMs}ms;`
                + ' a call that outlives this may take the process down on the way out.',
            );
        }
    }

    public async openStartupWindow(): Promise<void> {
        // In a finally, so that a launch that failed on its way here still lets later requests
        // through: `openLaunchRequest` queues everything until this flag is set, and a queue that
        // is never drained is a Studio that silently ignores every document dropped on it.
        try {
            // Before anything else, including the launcher: `--build` is not a window this session
            // opens on, it is the session. Nothing below it runs - no home screen, no reopen of the
            // last project, no first-run setup - and the run ends in the process exiting with a
            // code. See {@link CommandLineBuildRun}.
            const build = this.getCommandLineBuild();
            if (build) {
                await new CommandLineBuildRun(this, {
                    resolveDirectory: candidate => resolveExistingDirectory(candidate),
                    recentProjects: () => this.globalState.recentlyOpened.list(),
                    isProjectDirectory: directoryHoldsProject,
                }).run(build);
                return;
            }

            // Both answers are wanted before the launcher is built, because between them they say
            // whether it is to be shown at all. A path handed to this launch outranks the standing
            // preference below it: the author double-clicked something, which is more specific
            // than anything they once said about where to resume.
            this.queueLaunchOpensFromArgv();
            const startup = this.queuedLaunchOpens.length > 0 ? null : this.resolveSessionStartupProject();

            await this.ensureLauncher({ deferShow: this.startupOpensProject(startup) });

            if (this.queuedLaunchOpens.length > 0) {
                if (await this.drainQueuedLaunchOpens()) {
                    return;
                }
                // Nothing Studio was pointed at could be acted on, so the home screen is where
                // this launch ends after all.
                this.revealHeldBackLauncher();
                return;
            }

            if (!startup) {
                return;
            }

            const launcher = this.findLauncher();
            if (!launcher) {
                this.logger.warn("[Startup] The launcher is gone; not opening the requested project.");
                return;
            }

            this.logger.info(
                `[Startup] Opening project "${startup.projectPath}" (matched by ${startup.source})`,
            );
            try {
                await this.openProject(launcher, startup.projectPath);
            } catch (error) {
                this.logger.error(`[Startup] Could not open "${startup.projectPath}":`, error);
                this.revealHeldBackLauncher();
            }
        } finally {
            this.startupSettled = true;
        }
    }

    /**
     * Paths handed to Studio before it had anywhere to put them.
     *
     * macOS delivers `open-file` before `ready` on a cold launch - that is the *only* way a
     * double-clicked document reaches an app there, since the path never appears in argv - so the
     * request exists before the first window does. Held here and drained by
     * {@link openStartupWindow}, which is also what keeps a double-clicked project from racing the
     * "reopen the last project" it must override.
     */
    private readonly queuedLaunchOpens: LaunchOpenRequest[] = [];

    /** True once {@link openStartupWindow} has decided what this session opens on. */
    private startupSettled = false;

    /** Reads paths against the disk. Injected into the resolver so that stays pure and testable. */
    private launchOpenLookup(base?: string): LaunchOpenLookup {
        return {
            resolveFile: candidate => resolveExistingFile(candidate, base),
            resolveDirectory: candidate => resolveExistingDirectory(base ? path.resolve(base, candidate) : candidate),
            isProjectDirectory: directoryHoldsProject,
            dirname: filePath => path.dirname(filePath),
            extname: filePath => path.extname(filePath),
        };
    }

    /**
     * Take a launch's paths and act on the first one Studio recognises. Answers whether it did.
     *
     * `base` is the working directory the paths are relative to, which for a second launch is that
     * process's rather than this one's - the whole reason Electron reports it with the event.
     */
    public async openLaunchPaths(candidates: readonly string[], base?: string): Promise<boolean> {
        const request = resolveFirstLaunchOpenRequest(candidates, this.launchOpenLookup(base));
        if (!request) {
            return false;
        }
        return this.openLaunchRequest(request);
    }

    /**
     * Act on one resolved request now, or queue it if this launch has not yet decided what it
     * opens on. Answers whether it was acted on.
     */
    private async openLaunchRequest(request: LaunchOpenRequest): Promise<boolean> {
        if (!this.startupSettled) {
            this.queuedLaunchOpens.push(request);
            return false;
        }
        return this.applyLaunchOpenRequest(request);
    }

    /**
     * Queue the path this process was started with, if it was started with one Studio recognises.
     *
     * Separate from the drain so the queue is complete *before* the launcher is built:
     * {@link openStartupWindow} has to know whether this launch ends in a project to know whether
     * to show the home screen on the way. Only argv is narrowed to one path (see
     * `resolveFirstLaunchOpenRequest`).
     */
    private queueLaunchOpensFromArgv(): void {
        const fromArgv = resolveFirstLaunchOpenRequest(this.getLaunchOpenPaths(), this.launchOpenLookup());
        if (fromArgv) {
            this.queuedLaunchOpens.push(fromArgv);
        }
    }

    /**
     * Whether this launch is headed straight into a project window, and can therefore keep the
     * home screen off the screen on the way (see {@link holdLauncherBack}).
     *
     * A package is not one: it opens the import wizard, which hangs off the launcher and can be
     * cancelled, and cancelling it back to a hidden home screen would leave nothing on screen.
     */
    private startupOpensProject(startup: { projectPath: string } | null): boolean {
        if (this.queuedLaunchOpens.length > 0) {
            return this.queuedLaunchOpens.every(request => request.kind === "project");
        }
        return startup !== null;
    }

    /** Act on everything that arrived before there was a window. Answers whether anything did. */
    private async drainQueuedLaunchOpens(): Promise<boolean> {
        if (this.queuedLaunchOpens.length === 0) {
            return false;
        }

        let opened = false;
        // In order, and all of them: a cold launch can carry several `open-file` events, and each
        // one is a document somebody asked for. Only argv is narrowed to one (see
        // `resolveFirstLaunchOpenRequest`).
        for (const request of this.queuedLaunchOpens.splice(0)) {
            opened = await this.applyLaunchOpenRequest(request) || opened;
        }
        return opened;
    }

    private async applyLaunchOpenRequest(request: LaunchOpenRequest): Promise<boolean> {
        try {
            if (request.kind === "project") {
                await this.openProjectFromOutside(request.projectPath);
                return true;
            }
            await this.openPackageFromOutside(request.packagePath);
            return true;
        } catch (error) {
            this.logger.error("[Launch] Could not act on the path Studio was given:", error);
            return false;
        }
    }

    /**
     * The window an externally-requested open should be attributed to.
     *
     * A workspace before the launcher, deliberately. `openProject` retires a *launcher* opener the
     * moment the project is up - correct when the author clicked a row in it, wrong when they
     * double-clicked a file in the file manager and Studio happened to have its home screen open
     * behind everything. Preferring a workspace leaves that home screen where they left it.
     *
     * Undefined when there is nothing at all, which is a cold launch: the caller raises the
     * launcher first, so the open inherits the whole of `openStartupWindow`'s failure behaviour.
     */
    private launchOpener(): AppWindow | undefined {
        const alive = this.windowManager.getWindows().filter(window => !window.isClosed());
        return alive.find(window => window.getWindowType() === WindowAppType.Workspace)
            ?? alive.find(window => window.getWindowType() === WindowAppType.Launcher)
            ?? alive[0];
    }

    /**
     * Open a project Studio was pointed at from outside - a file association, a shell argument, a
     * second launch handing it over.
     *
     * Goes through {@link openProject} like every other way in, so one project stays one window:
     * a project that is already open is focused rather than opened twice, and nothing is retired
     * that the author did not ask to leave.
     */
    public async openProjectFromOutside(projectPath: string): Promise<void> {
        const existing = this.findWorkspaceForProject(projectPath);
        if (existing) {
            if (existing.win.isMinimized()) {
                existing.win.restore();
            }
            existing.focus();
            this.logger.info(`[Launch] "${projectPath}" is already open; focusing its window.`);
            return;
        }

        let opener = this.launchOpener();
        if (!opener) {
            await this.ensureLauncher();
            opener = this.findLauncher();
        }
        if (!opener) {
            this.logger.warn(`[Launch] No window to open "${projectPath}" from.`);
            return;
        }

        this.logger.info(`[Launch] Opening project "${projectPath}".`);
        await this.openProject(opener, projectPath);
    }

    /**
     * Open the import wizard on a package Studio was pointed at from outside.
     *
     * A package is not a project: nothing can be opened until it has been unpacked somewhere, and
     * where is a question only the author can answer. So this raises the wizard already on its
     * import flow with the package chosen, and opens whatever comes out of it - the same hand-off
     * the launcher's own New Project makes, except that main is the one waiting for the answer,
     * because no renderer asked for this window.
     */
    public async openPackageFromOutside(packagePath: string): Promise<void> {
        let opener = this.launchOpener();
        if (!opener) {
            await this.ensureLauncher();
            opener = this.findLauncher();
        }
        if (!opener) {
            this.logger.warn(`[Launch] No window to open "${packagePath}" from.`);
            return;
        }

        this.logger.info(`[Launch] Opening the import wizard on "${packagePath}".`);
        const wizard = await this.launchProjectWizard(opener, { packagePath }, {
            parent: opener.win,
            resizable: false,
            width: 760,
            height: 620,
            center: true,
            x: undefined,
            y: undefined,
        });
        // Read, not readwrite, and not recursive - one file that gets copied out of. The same grant
        // the wizard's own package picker makes, because the renderer cannot tell the two apart.
        this.storageManager.grantFileSystemAccess(wizard, packagePath, "read", false, undefined, "session");
        // Independent for the reason the wizard always is: the window it hangs from may retire
        // while the author is still choosing where to unpack.
        opener.addChild(wizard, "independent");

        wizard.setCloseResultResolver(result => {
            if (result && result.created) {
                void this.openProjectFromOutside(result.projectPath).catch(error => {
                    this.logger.error("[Launch] Could not open the unpacked project:", error);
                });
            }
        });
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
     * Never throws and never blocks the close - the second half enforced by a deadline
     * ({@link CLOSE_CHECKPOINT_TIMEOUT_MS}, or `versionControl.quitCheckpointTimeoutSeconds` when
     * the whole app is going away) rather than assumed. A project with no repository, a host
     * with no backend, and a tree that has not changed all answer "nothing to do" rather than
     * failing (see VcsManager.checkpoint); a repository somebody else has locked answers nothing at
     * all, and used to leave the window unclosable.
     *
     * The app quitting runs this as well, over every open workspace - see
     * {@link App.checkpointOpenWorkspacesForShutdown}. It used to be left out, on the reasoning
     * that a commit's duration is a function of how much the author changed and that hanging
     * Cmd+Q on it would trade a bounded "lost the last few seconds" for an unbounded wait. The
     * deadline above is what settles that: the wait is bounded whichever exit asks for it, and
     * the alternative was that quitting - the way a session actually ends, and the one exit that
     * closes every project at once - recorded nothing, while the setting said a workspace that
     * closes is check pointed.
     */
    private async checkpointBeforeClose(
        window: AppWindow<WindowAppType.Workspace>,
        timeoutMs: number = CLOSE_CHECKPOINT_TIMEOUT_MS,
    ): Promise<void> {
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
                    () => reject(new Error(`the checkpoint did not finish within ${timeoutMs}ms`)),
                    timeoutMs,
                ).unref?.()),
            ]);
        } catch (error) {
            this.logger.warn(`[Vcs] Could not check point before closing the project: ${String(error)}`);
        }
    }

    /**
     * Whether any live window still holds this project - a workspace, or the Dev Mode window a
     * workspace opened.
     *
     * The window that is going away has usually not been unregistered yet when this is asked (the
     * `window-closed` event runs before `unregisterWindow`), which is why "live" means
     * `!isClosed()`: a destroyed window answers no for itself.
     */
    public hasLiveWindowForProject(projectPath: string): boolean {
        const target = normalizeProjectPath(projectPath);
        return this.windowManager.getWindows().some(window => {
            if (window.isClosed()) {
                return false;
            }
            const candidate = (window.getProps() as { projectPath?: unknown } | undefined)?.projectPath;
            return typeof candidate === "string" && normalizeProjectPath(candidate) === target;
        });
    }

    /**
     * Stop everything this project has running: Dev Mode, the preview runtime, and a test's game
     * process.
     *
     * **A project's runtimes belong to its window.** Everything that drives them lives there - the
     * Run control that started them, the stop button, the console they report into, the status the
     * toolbar shows. With the window gone, a Dev Mode window went on recompiling on every file
     * change with its output going nowhere and no way to stop it short of closing it by hand, and a
     * preview went on running as a whole separate process. Leaving them was never a decision; there
     * simply was no hook.
     *
     * Called for every way a workspace can end - the close box, Cmd+W, Back to Launcher, and a
     * switch retiring the window it came from - because it hangs off the window closing rather than
     * off any one of those gestures.
     *
     * Never throws and never blocks the close: the window is already gone by the time this runs.
     */
    public async stopProjectRuntimes(projectPath: string): Promise<void> {
        const results = await Promise.allSettled([
            this.devModeManager.stop(projectPath),
            this.previewManager.stop(projectPath),
            this.gameTestManager.stopProject(projectPath),
        ]);
        for (const result of results) {
            if (result.status === "rejected") {
                this.logger.warn(`[Runtime] Could not stop a runtime for "${projectPath}":`, result.reason);
            }
        }
    }

    /**
     * Stop every project's runtimes. Used on the way out of the app.
     *
     * Not the same thing as the windows closing, and that is the whole reason it exists: a preview
     * and a test run are separate *processes*, and only Windows' job object reaps those with their
     * parent - on macOS and Linux they are reparented and outlive Studio.
     */
    public async stopAllProjectRuntimes(): Promise<void> {
        await Promise.allSettled([
            this.devModeManager.stopAll(),
            this.previewManager.stopAll(),
            this.gameTestManager.stopAll(),
        ]);
    }

    /**
     * The workspaces still on screen, in the order the window manager holds them.
     *
     * Both halves of the shutdown ask the same question, and asking it twice in two places is how
     * one of them would end up covering a different set of windows than the other.
     */
    private liveWorkspaceWindows(): AppWindow<WindowAppType.Workspace>[] {
        return this.windowManager.getWindows().filter(
            (window): window is AppWindow<WindowAppType.Workspace> =>
                !window.isClosed() && window.getWindowType() === WindowAppType.Workspace,
        );
    }

    /** Flush every open workspace concurrently. Used on the way out of the app. */
    public async flushAllWorkspacesPendingSaves(): Promise<void> {
        const workspaces = this.liveWorkspaceWindows();
        for (const window of workspaces) {
            this.reportWorkspaceCloseStage(window, "saving");
        }
        await Promise.allSettled(workspaces.map(window => this.flushWorkspacePendingSaves(window)));
    }

    /**
     * The configured checkpoint budget for a quit, in milliseconds.
     *
     * Clamped rather than trusted. Global state is a file on disk and the Settings row is not the
     * only way into it; a value edited by hand into something enormous would be an application
     * that cannot be quit, which is the one outcome the deadline exists to rule out.
     */
    private resolveQuitCheckpointTimeoutMs(): number {
        const stored = this.globalState.get(QUIT_CHECKPOINT_TIMEOUT_KEY);
        const seconds = typeof stored === "number" && Number.isFinite(stored)
            ? stored
            : QUIT_CHECKPOINT_TIMEOUT_DEFAULT_SECONDS;
        const clamped = Math.min(
            Math.max(seconds, QUIT_CHECKPOINT_TIMEOUT_MIN_SECONDS),
            QUIT_CHECKPOINT_TIMEOUT_MAX_SECONDS,
        );
        return Math.round(clamped * 1000);
    }

    /**
     * Check point every open workspace on the way out of the app.
     *
     * Quitting does not come through the window close guard: `isQuitting()` makes every guard
     * stand aside, so that a confirmation sheet cannot cancel a quit half-way through. That is
     * what this exists for. Without it, Cmd+Q, the Quit menu item and the tray's Quit - the exits
     * that close every project at once - were the exits that recorded nothing, while
     * `versionControl.checkpointOnClose` told the author a closing workspace is check pointed.
     *
     * The setting is read here as well as in {@link App.checkpointBeforeClose}, so that an author
     * who turned it off is not shown a window telling them a checkpoint is being recorded.
     *
     * Concurrent, because Lore queues per project and two projects do not contend; bounded per
     * project by `timeoutMs`, so one repository somebody else has locked cannot spend the whole
     * shutdown deadline on behalf of the others. A budget of nothing skips the step: it is how
     * `versionControl.quitCheckpointTimeoutSeconds` says that a quit is not the moment to wait,
     * and it leaves a workspace closed by hand recording its checkpoint as before.
     */
    public async checkpointOpenWorkspacesForShutdown(timeoutMs: number): Promise<void> {
        if (timeoutMs <= 0 || this.globalState.get("versionControl.checkpointOnClose") === false) {
            return;
        }
        const workspaces = this.liveWorkspaceWindows();
        for (const window of workspaces) {
            this.reportWorkspaceCloseStage(window, "checkpoint");
        }
        await Promise.allSettled(
            workspaces.map(window => this.checkpointBeforeClose(window, timeoutMs)),
        );
    }


    /**
     * Run a workspace's exit: confirm if asked, flush, checkpoint, and then either stand aside for
     * the launcher or let the close stand.
     *
     * `intent` is the whole difference between the two exits, and it is an argument rather than a
     * preference on purpose. "Close this window" and "leave this project" are different things the
     * author asks for, and they used to arrive on one path with a boolean setting picking which
     * one happened - so a profile could have one or the other but never both. The exit that
     * follows is identical in every other respect, which is why they share this method.
     */
    private async handleWorkspaceExitRequest(
        window: AppWindow<WindowAppType.Workspace>,
        intent: WorkspaceExitIntent,
    ): Promise<void> {
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

        // The home screen comes up only for the exit that asked for it. A plain close is now
        // allowed to be a plain close: it hands the decision back to the last-window handling
        // (tray residency on Windows, staying alive on macOS), which is what the author expects
        // from a window's close box and from Cmd+W.
        if (intent === "launcher") {
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
     * Workspaces whose exit is still settling, so a second request does not stack a second
     * confirmation sheet on top of the first.
     *
     * Held here rather than in a closure per window because the two exits are two entry points -
     * the window's close guard and the return-to-launcher channel - and a guard each would let one
     * gesture start while the other was mid-flight. A window that is exiting is exiting, whichever
     * of the two asked for it.
     */
    private readonly workspaceExits = new Set<AppWindow<WindowAppType.Workspace>>();

    /**
     * Start a workspace's exit, or bring the one already running to the front.
     *
     * The usual reason for a second attempt is that the confirmation sheet is not where the user
     * is looking, so focusing beats swallowing the gesture without a trace.
     */
    public requestWorkspaceExit(
        window: AppWindow<WindowAppType.Workspace>,
        intent: WorkspaceExitIntent,
    ): void {
        if (this.workspaceExits.has(window)) {
            window.focus();
            return;
        }

        this.workspaceExits.add(window);
        void this.handleWorkspaceExitRequest(window, intent)
            .catch(error => {
                this.logger.error("Failed to handle workspace exit request:", error);
            })
            .finally(() => {
                this.workspaceExits.delete(window);
            });
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

    /**
     * Build the Settings window. Private on purpose: {@link revealSettings} is the only caller, and
     * it is the one that knows there may already be one open.
     *
     * Deliberately parentless - see revealSettings for what the parent link used to cost.
     */
    private async launchSettings(
        props: WindowProps[WindowAppType.Settings],
        options: Partial<Electron.BrowserWindowConstructorOptions> = {},
    ): Promise<AppWindow<WindowAppType.Settings>> {
        const config: WindowConfig<WindowAppType.Settings> = {
            windowType: WindowAppType.Settings,
            isolated: true,
            autoFocus: true,
            preload: this.getPreloadScript(),
            options: {
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

    /**
     * Build a workspace window.
     *
     * `options.show === false` covers two different windows, and `deferredShow` is what tells them
     * apart: a build running with nobody at the screen, which stays hidden for its whole life, and
     * a window loading a project behind the one it is about to replace, which is on its way to the
     * screen the moment that project answers. The second is still somebody's window - it keeps the
     * crash and hang prompts - so only the first drops them.
     */
    async launchWorkspace(
        parent: AppWindow<WindowAppType.Settings>,
        props: WindowProps[WindowAppType.Workspace],
        options: Partial<Electron.BrowserWindowConstructorOptions> = {},
        deferredShow: boolean = false,
    ): Promise<AppWindow<WindowAppType.Workspace>> {
        const hidden = options.show === false;
        // A window that is not being shown is not being focused either; whoever shows it later
        // focuses it then. A window nobody will ever look at may not put a native dialog in front
        // of an operator either, which is the headless case and only that one.
        const headless = hidden && !deferredShow;
        const config: WindowConfig<WindowAppType.Workspace> = {
            windowType: WindowAppType.Workspace,
            isolated: true,
            autoFocus: !hidden,
            failurePrompts: !headless,
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
        if (hidden) {
            // Chromium treats a window that is not on screen as backgrounded and drops its timers to
            // one a second. A build runs its whole life that way, and a build is full of debounces,
            // polls and queues that would each pay that second; a window loading a project before it
            // takes the screen would pay it on the one stretch the author is waiting through. The
            // second case turns throttling back on once it is shown - see `presentReplacement`.
            window.getWebContents().setBackgroundThrottling(false);
        }

        // Closing a workspace means "leave this project", not "quit the app". The decision needs
        // to await a confirmation sheet and the launcher's window, so always take the close over
        // and re-issue it via forceClose() once settled.
        //
        // The close box, Cmd+W and Quit all arrive here, and all of them mean "close this window" -
        // not "take me home". Leaving for the launcher is its own gesture and its own channel; see
        // `requestWorkspaceExit`.
        window.setCloseGuard(() => {
            this.requestWorkspaceExit(window, "close");
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
        options: OpenProjectOptions = {},
    ): Promise<AppWindow<WindowAppType.Workspace>> {
        this.authorizeRecentProjectAccess(opener, projectPath);

        const openerIsLauncher = opener.getWindowType() === WindowAppType.Launcher;
        // "Reuse this window" only means something for a workspace: the launcher retires either
        // way, and no other window type is a place a project could take over.
        const replaceOpener = Boolean(options.replaceOpener)
            && opener.getWindowType() === WindowAppType.Workspace;

        // forceClose() is deliberate wherever the opener is retired below: opening a project is
        // not a "close this workspace" gesture, so it must skip the close guard's confirm sheet,
        // which would otherwise interrupt the open with a question nobody asked.
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
        // A replacement loads out of sight and takes the screen only once its project has answered:
        // the author asked for this window to become another project, and a second window appearing
        // over the first and the first closing out from under it is the one thing that does not read
        // as that. Not for a project someone else already has coming up (`pending`): that window was
        // launched on their terms and is not ours to hide or show.
        const handOver = replaceOpener && !options.background && !pending;
        if (handOver) {
            // The window in front of the author is the only one on screen while the replacement
            // loads, so it is the one that has to say what is going on.
            this.reportWorkspaceCloseStage(opener as AppWindow<WindowAppType.Workspace>, "switching");
        }
        const launch = pending ?? this.launchWorkspace(
            opener,
            { projectPath, ...(options.commandLineBuild ? { commandLineBuild: options.commandLineBuild } : {}) },
            options.background
                // Never sized, never placed, never shown. A window with no frame on screen has no
                // bounds worth choosing, and `show: false` is what keeps it off the operator's
                // desktop; `launchWorkspace` reads it and declines to focus what it did not show.
                ? { show: false }
                : {
                    minWidth: 800,
                    minHeight: 600,
                    // Sized and placed as always - it is only held back from the screen until the
                    // window it replaces has left it.
                    ...(handOver ? { show: false } : {}),
                    ...this.workspacePlacement(opener, replaceOpener),
                },
            handOver,
        );

        if (!pending) {
            this.projectOpenings.set(key, launch);
            void launch.catch(() => void 0).finally(() => {
                this.projectOpenings.delete(key);
            });
        }

        if (handOver) {
            // A launch that threw leaves no window to report anything, and an author sitting under a
            // scrim that nothing would ever lift.
            void launch.catch(() => {
                this.reportWorkspaceCloseStage(opener as AppWindow<WindowAppType.Workspace>, null);
            });
        }

        const workspaceWindow = await launch;

        if (handOver && workspaceWindow !== opener) {
            this.handOverToReplacement(opener as AppWindow<WindowAppType.Workspace>, workspaceWindow, retireOpener);
            return workspaceWindow;
        }

        if ((openerIsLauncher || replaceOpener) && workspaceWindow !== opener) {
            workspaceWindow.onLoadResult(ok => {
                if (ok) {
                    void retireOpener();
                } else if (openerIsLauncher && !options.background) {
                    // The workspace came up on its error screen, so the home screen it was opened
                    // from is the only way on from here - and a startup that was headed into this
                    // project has been holding that home screen back for exactly this answer.
                    //
                    // Except in the background: there is nobody to hand a home screen to, the caller
                    // is already being told the load failed, and putting a window on an operator's
                    // screen is the one thing this mode must never do.
                    this.revealHeldBackLauncher();
                }
            });
        }
        return workspaceWindow;
    }

    /**
     * Wire the window being replaced, and the hidden window replacing it, to the order they change
     * places in - see {@link handOverWorkspace}, which owns that order and nothing else.
     *
     * Everything here is the window work that order asks for: what the frame of the outgoing window
     * is, what closing it involves, and where the incoming one goes if it never gets to replace
     * anything.
     */
    private handOverToReplacement(
        opener: AppWindow<WindowAppType.Workspace>,
        replacement: AppWindow<WindowAppType.Workspace>,
        retireOpener: () => Promise<void>,
    ): void {
        handOverWorkspace({
            opener: {
                clearSwitchingStage: () => this.reportWorkspaceCloseStage(opener, null),
                captureFrame: () => ({
                    bounds: opener.win.getBounds(),
                    maximized: opener.win.isMaximized(),
                    fullScreen: opener.win.isFullScreen(),
                }),
                retire: retireOpener,
            },
            replacement: {
                isClosed: () => replacement.isClosed(),
                onLoadResult: fn => replacement.onLoadResult(fn),
                onClose: fn => {
                    replacement.onClose(fn);
                },
                adoptFrame: frame => {
                    if (frame.maximized) {
                        replacement.win.maximize();
                    } else if (!frame.fullScreen) {
                        replacement.win.setBounds(frame.bounds);
                    }
                },
                stepAside: () => this.stepAside(opener, replacement),
                show: () => {
                    // Exempt from Chromium's timer throttling only while it was loading out of
                    // sight; a window on screen has no need of it, and minimising this one later
                    // should cost what minimising any other workspace costs.
                    replacement.getWebContents().setBackgroundThrottling(true);
                    void replacement.show();
                    replacement.focus();
                },
                enterFullScreen: () => replacement.win.setFullScreen(true),
            },
            timeoutMs: REPLACEMENT_HANDOVER_TIMEOUT_MS,
            onTimeout: () => {
                this.logger.warn("[App] The replacement workspace did not report a load result in time; showing it and keeping the window it was replacing.");
            },
        });
    }

    /**
     * Move a window that was placed to replace another one out from exactly on top of it, because
     * the replacement did not happen: the project failed to open, so both windows are staying, and
     * two frames in the same place would read as one.
     */
    private stepAside(opener: AppWindow, replacement: AppWindow): void {
        const placement = this.workspacePlacement(opener, false);
        if (typeof placement.x === "number" && typeof placement.y === "number"
            && typeof placement.width === "number" && typeof placement.height === "number") {
            replacement.win.setBounds({
                x: placement.x,
                y: placement.y,
                width: placement.width,
                height: placement.height,
            });
            return;
        }
        // No room to step aside (a maximised opener, most often), so the centred default frame it
        // would have had is used instead - distinct enough on its own.
        if (typeof placement.width === "number" && typeof placement.height === "number") {
            replacement.win.setSize(placement.width, placement.height);
        }
        replacement.win.center();
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

        // Confine the preview renderer the way a build would: to the app
        // protocol unless the project opts into HTTP, and to the project's
        // allowlist when it states one. Must be applied BEFORE loadFile so the
        // initial document load and every subsequent game request is governed.
        const { allowHttp, allowlist } = await readProjectNetworkSettings(props.projectPath);
        const previewWebContentsId = window.win.webContents.id;
        devModeNetworkPolicy.apply(previewWebContentsId, { allowHttp, allowlist });
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

    /**
     * Raise the window that asks whether a server is trusted.
     *
     * Modal on whoever asked, exactly as the plugin permission prompt is: the question is
     * about the address that window is working with, and leaving it answerable later
     * would let a second one be raised for the same address.
     *
     * Shorter than the permission prompt because it holds less - an address, one line of
     * subject, a fingerprint behind a disclosure and two buttons.
     */
    async launchServerTrustPrompt(
        parent: AppWindow,
        props: WindowProps[WindowAppType.ServerTrustPrompt],
        options: Partial<Electron.BrowserWindowConstructorOptions> = {},
    ): Promise<AppWindow<WindowAppType.ServerTrustPrompt>> {
        const config: WindowConfig<WindowAppType.ServerTrustPrompt> = {
            windowType: WindowAppType.ServerTrustPrompt,
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
                width: 480,
                height: 330,
                center: true,
                frame: false,
                titleBarStyle: "hidden",
                show: false,
                ...options,
            },
        };
        const window = new AppWindow<WindowAppType.ServerTrustPrompt>(this, config, props);
        window.setTitle("Server Trust - NarraLeaf Studio");
        this.applyWindowIcon(window);
        window.showWhenReady();

        await window.loadFile(this.getAppEntry(WindowAppType.ServerTrustPrompt));

        return window;
    }
}
