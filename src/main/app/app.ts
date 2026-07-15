import { IPCEventType } from "@shared/types/ipcEvents";
import { WindowAppType, WindowControlPolicy, WindowProps } from "@shared/types/window";
import { BaseApp, BaseAppConfig } from "./application/baseApp";
import { AppWindow, WindowConfig } from "./application/managers/window/appWindow";
import { DevModeManager } from "./application/managers/devMode/DevModeManager";
import { devModeNetworkPolicy, readProjectAllowHttp } from "./application/managers/devMode/devModeNetworkPolicy";
import { GameBuildManager } from "./application/managers/build/GameBuildManager";
import { PreviewManager } from "./application/managers/preview/PreviewManager";

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
    }

    private readonly devModeManager: DevModeManager;
    private readonly previewManager: PreviewManager;
    private readonly gameBuildManager: GameBuildManager;

    public getDevModeManager(): DevModeManager {
        return this.devModeManager;
    }

    public getPreviewManager(): PreviewManager {
        return this.previewManager;
    }

    public getGameBuildManager(): GameBuildManager {
        return this.gameBuildManager;
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

        this.launcherStartup = this.launchLauncher({
            backgroundColor: "#0f1115",
        }).then(launcher => {
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

        await window.loadFile(this.getAppEntry(WindowAppType.Workspace));

        // Project is added to recently opened only when workspace successfully loads it (see WorkspaceContext)

        return window;
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
                backgroundColor: "#0f1115",
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
                backgroundColor: "#111318",
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
