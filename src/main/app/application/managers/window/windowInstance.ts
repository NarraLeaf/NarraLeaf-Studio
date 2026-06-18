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
        this.applyNativeWindowControlVisibility();
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

    private applyNativeWindowControlVisibility(): void {
        if (process.platform === "darwin") {
            this.browserWindow.setWindowButtonVisibility(false);
        }
    }
}
