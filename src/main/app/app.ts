import { WindowAppType, WindowProps } from "@shared/types/window";
import { BaseApp, BaseAppConfig } from "./application/baseApp";
import { AppWindow, WindowConfig } from "./application/managers/window/appWindow";

export interface AppConfig extends BaseAppConfig {
}

export class App extends BaseApp {
    public static create(config: AppConfig): App {
        return new App(config);
    }

    constructor(public readonly config: AppConfig) {
        super(config);
    }

    async launchLauncher(options: Partial<Electron.BrowserWindowConstructorOptions>): Promise<AppWindow<WindowAppType.Launcher>> {
        const config: WindowConfig = {
            isolated: true,
            autoFocus: true,
            preload: null,
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
        const window = new AppWindow(this, config, {});
        window.registerPreloadScript(this.getPreloadScript());
        window.setTitle("Launcher - NarraLeaf Studio");
        window.setIcon(this.resolveResource("app-icon.ico"));

        await window.loadFile(this.getAppEntry(WindowAppType.Launcher));

        return window;
    }

    async launchSettings(
        parent: AppWindow<WindowAppType.Launcher>,
        props: WindowProps[WindowAppType.Settings],
        options: Partial<Electron.BrowserWindowConstructorOptions> = {},
    ): Promise<AppWindow<WindowAppType.Settings>> {
        const config: WindowConfig = {
            isolated: true,
            autoFocus: true,
            preload: null,
            options: {
                modal: true,
                parent: parent.win,
                minWidth: 800,
                minHeight: 500,
                width: 800,
                height: 500,
                // frame: false,
                // titleBarStyle: 'hidden',
                show: false,
                ...options,
            },
        };
        const window = new AppWindow(this, config, props);
        window.registerPreloadScript(this.getPreloadScript());
        window.setTitle("Settings - NarraLeaf Studio");
        window.setIcon(this.resolveResource("app-icon.ico"));

        await window.loadFile(this.getAppEntry(WindowAppType.Settings));

        return window;
    }
}