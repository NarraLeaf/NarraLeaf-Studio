import { BrowserWindow, WebPreferences } from "electron";

export interface WindowInstanceConfig {
    isolated: boolean;
    preload: string | null;
    options?: Electron.BrowserWindowConstructorOptions;
}

export class WindowInstance {
    private browserWindow: BrowserWindow;

    constructor(config: WindowInstanceConfig) {
        this.browserWindow = new BrowserWindow({
            webPreferences: this.getWebPreference(config),
            ...config.options,
        });
    }

    public getBrowserWindow(): BrowserWindow {
        return this.browserWindow;
    }

    public getWebContents(): Electron.WebContents {
        return this.browserWindow.webContents;
    }

    private getWebPreference(config: WindowInstanceConfig): WebPreferences {
        return {
            contextIsolation: config.isolated,
            preload: config.preload ?? undefined,
        };
    }
} 