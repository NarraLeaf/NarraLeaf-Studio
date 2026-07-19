import { BrowserWindow, WebPreferences } from "electron";
import { WindowControlPolicy } from "@shared/types/window";

const MACOS_TRAFFIC_LIGHT_POSITION: Electron.Point = { x: 14, y: 12 };

export interface WindowInstanceConfig {
    isolated: boolean;
    preload: string | null;
    options?: Electron.BrowserWindowConstructorOptions;
    windowControlPolicy?: WindowControlPolicy;
}

export class WindowInstance {
    private browserWindow: BrowserWindow;

    constructor(config: WindowInstanceConfig) {
        const options = this.getWindowOptions(config);
        this.browserWindow = new BrowserWindow({
            webPreferences: this.getWebPreference(config),
            ...options,
        });
        this.applyNativeWindowControls(config, options);
    }

    public getBrowserWindow(): BrowserWindow {
        return this.browserWindow;
    }

    public getWebContents(): Electron.WebContents {
        if (this.browserWindow.isDestroyed()) {
            throw new Error("Browser window is destroyed. Tried to get web contents.");
        }
        return this.browserWindow.webContents;
    }

    private getWebPreference(config: WindowInstanceConfig): WebPreferences {
        return {
            contextIsolation: config.isolated,
            preload: config.preload ?? undefined,
        };
    }

    private getWindowOptions(config: WindowInstanceConfig): Electron.BrowserWindowConstructorOptions | undefined {
        const options = config.options;
        if (process.platform !== "darwin" || options?.frame !== false || this.getWindowControlPolicy(config) === WindowControlPolicy.None) {
            return options;
        }

        return {
            ...options,
            titleBarStyle: options.titleBarStyle ?? "hidden",
            trafficLightPosition: options.trafficLightPosition ?? MACOS_TRAFFIC_LIGHT_POSITION,
        };
    }

    private applyNativeWindowControls(
        config: WindowInstanceConfig,
        options?: Electron.BrowserWindowConstructorOptions,
    ): void {
        if (process.platform !== "darwin" || options?.frame !== false) {
            return;
        }

        const visible = this.getWindowControlPolicy(config) !== WindowControlPolicy.None;
        this.browserWindow.setWindowButtonVisibility(visible);
        if (visible) {
            this.browserWindow.setWindowButtonPosition(options.trafficLightPosition ?? MACOS_TRAFFIC_LIGHT_POSITION);
        }
    }

    private getWindowControlPolicy(config: WindowInstanceConfig): WindowControlPolicy {
        return config.windowControlPolicy ?? WindowControlPolicy.Standard;
    }
}
