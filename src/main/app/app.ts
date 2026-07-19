import { IPCEventType } from "@shared/types/ipcEvents";
import { WindowAppType, WindowControlPolicy, WindowProps } from "@shared/types/window";
import { BaseApp, BaseAppConfig } from "./application/baseApp";
import { getGameHostWindowBackgroundColor } from "./application/theme";
import { AppWindow, WindowConfig } from "./application/managers/window/appWindow";
import { DevModeManager } from "./application/managers/devMode/DevModeManager";
import { devModeNetworkPolicy, readProjectAllowHttp } from "./application/managers/devMode/devModeNetworkPolicy";
import { GameBuildManager } from "./application/managers/build/GameBuildManager";
import { PreviewManager } from "./application/managers/preview/PreviewManager";
import { VcsManager } from "./application/managers/vcs/VcsManager";
// Shared with the recently-opened history, which must agree with the "already open?" lookup here.
import { normalizeProjectPath } from "@shared/utils/recentProject";

export interface AppConfig extends BaseAppConfig {
}

export class App extends BaseApp {
    public static create(config: AppConfig): App {
        return new App(config);
    }

    constructor(public readonly config: AppConfig) {
        super(config);
        this.devModeManager = new DevModeManager(this);
        this.previewManager = new PreviewManager(this);
        this.gameBuildManager = new GameBuildManager(this);
        this.vcsManager = new VcsManager(this);
    }

    private readonly devModeManager: DevModeManager;
    private readonly previewManager: PreviewManager;
    private readonly gameBuildManager: GameBuildManager;
    private readonly vcsManager: VcsManager;

    public getDevModeManager(): DevModeManager {
        return this.devModeManager;
    }

    public getPreviewManager(): PreviewManager {
        return this.previewManager;
    }

    public getGameBuildManager(): GameBuildManager {
        return this.gameBuildManager;
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
        const window = new AppWindow<WindowAppType.Launcher>(this, config, {});
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
     * machine round-trip, so the default IPC timeout is far too short — timing out under a live
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

        // The app may have started quitting, or the window may be gone, while the sheet was up.
        // Reopening the launcher now would resurrect a window in the middle of a quit.
        if (this.isQuitting() || window.isClosed()) {
            return;
        }

        if (this.globalState.get("workspace.returnToLauncherOnClose")) {
            try {
                await this.ensureLauncher();
            } catch (error) {
                // Closing now would take the app down with it — this was probably the last
                // window, and the home the user asked to return to is the thing that failed.
                // Keeping the workspace open loses nothing and leaves them somewhere to work.
                this.logger.error("[Workspace] Keeping the window open, the launcher failed to start:", error);
                return;
            }
        }

        window.forceClose();
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
        // onto that window every time the user re-opened the same project — two toggles per press
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
     * {@link openProject} and each open a window of their own — two windows editing one project's
     * files, saving over each other.
     */
    private readonly projectOpenings = new Map<string, Promise<AppWindow<WindowAppType.Workspace>>>();

    /**
     * Open a project: authorize its files, then focus the window that already has it open, or
     * launch a fresh one.
     *
     * Every path that opens a project goes through here — the launcher's recent list and folder
     * picker, the project wizard, the native "Open Recent" menu, and the title-bar switcher — so
     * "one project, one window" holds however the user got there.
     *
     * A project that is already open is *focused*, never opened a second time, and focusing it
     * never retires the window the user came from: asking to go to another project is not asking
     * to close the one you are in. Only a genuine "open in this window" that actually launches
     * something new takes the opener's place, and only once the new window reports a working
     * project — an error screen is "ready" too, and trading a working workspace for a dead end is
     * exactly the thing to avoid.
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
        // window. Changes auto-save, so nothing is lost.
        const retireOpener = () => {
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
            if (openerIsLauncher) {
                retireOpener();
            }
            return existing;
        }

        const key = normalizeProjectPath(projectPath);
        const pending = this.projectOpenings.get(key);
        const bounds = replaceOpener ? opener.win.getBounds() : undefined;
        const launch = pending ?? this.launchWorkspace(opener, { projectPath }, bounds
            ? { minWidth: 800, minHeight: 600, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, center: false }
            : { minWidth: 800, minHeight: 600, width: 1400, height: 900 });

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
                    retireOpener();
                }
            });
        }
        return workspaceWindow;
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
