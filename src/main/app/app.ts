import { WindowAppType, WindowControlPolicy, WindowProps } from "@shared/types/window";
import { BaseApp, BaseAppConfig } from "./application/baseApp";
import { AppWindow, WindowConfig } from "./application/managers/window/appWindow";
import { DevModeManager } from "./application/managers/devMode/DevModeManager";

export interface AppConfig extends BaseAppConfig {
}

export class App extends BaseApp {
    public static create(config: AppConfig): App {
        return new App(config);
    }

    constructor(public readonly config: AppConfig) {
        super(config);
        this.devModeManager = new DevModeManager(this);
    }

    private readonly devModeManager: DevModeManager;

    public getDevModeManager(): DevModeManager {
        return this.devModeManager;
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
                width: 800,
                height: 500,
                frame: false,
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

        if (this.isDevMode()) {
            window.onKeyUp("F12", () => {
                window.toggleDevTools();
            });
        }

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
