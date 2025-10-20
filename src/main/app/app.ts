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

    async launchLauncher(options: Partial<Electron.BrowserWindowConstructorOptions>, props: WindowProps[WindowAppType.Launcher]): Promise<AppWindow<WindowAppType.Launcher>> {
        const config: WindowConfig = {
            isolated: true,
            autoFocus: true,
            preload: null,
            options,
        };
        const window = new AppWindow(this, config, props);
        window.registerPreloadScript(this.getPreloadScript());

        await window.loadFile(this.getAppEntry(WindowAppType.Launcher));

        return window;
    }
}