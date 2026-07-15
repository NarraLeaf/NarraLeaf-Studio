// Electron
import { app, dialog } from "electron/main";

// Utils
import fs from "fs";
import { Platform, PlatformInfo } from "@shared/types/os";
import { Logger } from "@shared/utils/logger";
import EventEmitter from "events";

// Managers
import { AppEventToken, AppInfo } from "@shared/types/app";
import { WindowAppType } from "@shared/types/window";
import { readJson } from "@shared/utils/json";
import { safeExecuteFn } from "@shared/utils/os";
import { StringKeyOf } from "@shared/utils/types";
import path from "path";
import { MenuManager } from "./managers/menuManager";
import { ProtocolManager } from "./managers/protocolManager";
import { StorageManager } from "./managers/storageManager";
import { WindowManager } from "./managers/windowManager";
import { GlobalStateManager } from "./managers/storage/globalState";
import { PluginPermissionManager } from "./managers/pluginPermissionManager";
import { PluginManager } from "./managers/pluginManager";
import { isMainDevMode, parseMainCommandLine } from "./commandLine";
import { APP_DISPLAY_NAME } from "@shared/constants/app";

export interface AppDependencies {
    protocolManager: ProtocolManager;
    windowManager: WindowManager;
    storageManager: StorageManager;
}
export interface BaseAppConfig { }

export type AppEvents = {
    "ready": [];
    "ready-failed": [error: Error];
};

export class BaseApp {
    public static Events = {
        Ready: "ready",
        ReadyFailed: "ready-failed"
    } as const;

    public readonly electronApp: Electron.App;
    public readonly platform: PlatformInfo;
    public readonly events: EventEmitter<AppEvents>;
    public readonly config: BaseAppConfig;
    public readonly logger: Logger;

    public readonly protocolManager: ProtocolManager;
    public readonly windowManager: WindowManager;
    public readonly menuManager: MenuManager;
    public readonly storageManager: StorageManager;
    public readonly globalState: GlobalStateManager;
    public readonly pluginPermissionManager: PluginPermissionManager;
    public readonly pluginManager: PluginManager;

    private initialized: boolean = false;
    private readyError: Error | null = null;
    private quitting: boolean = false;
    protected appInfo: AppInfo | null = null;
    private readonly commandLine = parseMainCommandLine(process.argv);

    constructor(config: BaseAppConfig) {
        this.config = config;
        this.electronApp = app;
        this.electronApp.on("before-quit", () => {
            this.quitting = true;
        });
        this.electronApp.setName(APP_DISPLAY_NAME);
        this.electronApp.setAboutPanelOptions({
            applicationName: APP_DISPLAY_NAME,
        });
        this.platform = Platform.getInfo(process, this.electronApp.isPackaged);
        this.logger = new Logger("MainProcess");
        this.events = new EventEmitter();

        this.configureCdp();
        this.setupUserDataDir();

        this.globalState = new GlobalStateManager(this.getUserDataDir());
        this.pluginPermissionManager = new PluginPermissionManager(this.getUserDataDir());
        this.pluginManager = new PluginManager(this.getUserDataDir(), this.pluginPermissionManager, {
            builtInPluginsDir: this.getBuiltInPluginsDir(),
        });

        this.protocolManager = new ProtocolManager(this);
        this.windowManager = new WindowManager(this);
        this.menuManager = new MenuManager(this);
        this.storageManager = new StorageManager(this);

        void this.prepare().catch((error) => this.failBootstrap(error));
    }

    public onReady(fn: (...args: AppEvents["ready"]) => void): AppEventToken {
        const handler = () => {
            safeExecuteFn(fn);
        };
        this.events.on<"ready">(BaseApp.Events.Ready, handler);

        return {
            cancel: () => {
                this.events.off(BaseApp.Events.Ready, handler);
            }
        };
    }

    /**
     * Wait until the app is ready
     * 
     * @example
     * ```ts
     * app.whenReady().then(() => {
     *     console.log("App is ready");
     * });
     * ```
     */
    public whenReady(): Promise<void> {
        if (this.initialized) {
            return Promise.resolve();
        }
        if (this.readyError) {
            return Promise.reject(this.readyError);
        }
        return new Promise((resolve, reject) => {
            const onReady = () => {
                this.events.off(BaseApp.Events.ReadyFailed, onFailed);
                resolve();
            };
            const onFailed = (error: Error) => {
                this.events.off(BaseApp.Events.Ready, onReady);
                reject(error);
            };
            this.events.once(BaseApp.Events.Ready, onReady);
            this.events.once(BaseApp.Events.ReadyFailed, onFailed);
        });
    }

    /**
     * Alias for whenReady
     */
    public untilReady(): Promise<void> {
        return this.whenReady();
    }

    /**
     * Return the application path.
     * 
     * This will return the project path in development and the path of the `app.asar` file in production.
     */
    public getAppPath(): string {
        // This will return "NarraLeaf-Studio\build\win-unpacked\resources\app.asar" in production
        // The asar archive includes package.json and "dist" directory
        // and "NarraLeaf-Studio\dist\main" in development
        const appDir = this.electronApp.getAppPath();

        return this.electronApp.isPackaged ? appDir : path.resolve(appDir, '../..');
    }

    public getResourcesDir(): string {
        const appDir = this.getAppPath();
        return this.electronApp.isPackaged ? path.resolve(appDir, "..", "resources") : path.resolve(appDir, "resources");
    }

    public resolveResource(p: string): string {
        return path.resolve(this.getResourcesDir(), p);
    }

    public getWindowIconPath(): string | null {
        if (process.platform === "darwin") {
            return null;
        }

        if (process.platform === "win32") {
            return this.resolveExistingResource("app-icon.ico", "app-icon.png");
        }

        return this.resolveExistingResource("app-icon.png", "app-icon.ico");
    }

    public getDockIconPath(): string | null {
        if (process.platform !== "darwin") {
            return null;
        }

        return this.resolveExistingResource("app-icon-mac.png", "app-icon.png", "app-icon.icns");
    }

    public getDistDir(): string {
        return path.resolve(this.getAppPath(), "dist");
    }

    public getBuiltInPluginsDir(): string {
        return path.resolve(this.getDistDir(), "builtin-plugins");
    }

    public getPublicDir(): string {
        return path.resolve(this.getAppPath(), this.isPackaged() ? "public" : "src/renderer/public");
    }

    public isPackaged(): boolean {
        return this.electronApp.isPackaged;
    }

    public getUserDataDir(): string {
        return app.getPath("userData");
    }

    public getPreloadScript(): string {
        return path.resolve(this.getDistDir(), "main", "preload.js");
    }

    public getDevTempDir(): string {
        return path.join(this.getAppPath(), ".dev", "temp");
    }

    public quit(): void {
        this.electronApp.quit();
    }

    /**
     * True once the whole app is on its way out (Quit menu item, Cmd+Q, session logout).
     * Window close guards must stand aside in that case, or they would cancel the quit.
     */
    public isQuitting(): boolean {
        return this.quitting;
    }

    public crash(error: string | Error): void {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        this.logger.error("[App] Fatal error, terminating:", message);
        try {
            if (this.electronApp.isReady()) {
                dialog.showErrorBox(`${APP_DISPLAY_NAME} — Fatal Error`, message);
            } else {
                console.error(message);
            }
        } finally {
            this.electronApp.exit(1);
        }
    }

    public isDevMode(): boolean {
        return isMainDevMode(this.commandLine, this.electronApp.isPackaged);
    }

    public getAppEntry(type: WindowAppType): string {
        return path.resolve(this.getDistDir(), "windows", type, "index.html");
    }

    public getAppInfo(): AppInfo {
        if (!this.appInfo) {
            throw new Error("App info is not available");
        }
        return this.appInfo;
    }

    public getGlobalState(): GlobalStateManager {
        if (!this.globalState) {
            throw new Error("Global state is not available");
        }
        return this.globalState;
    }

    /**
     * Setup development userData path if running in development mode
     * This must be called before creating managers that depend on userData path
     */
    private setupUserDataDir(): void {
        if (!this.electronApp.isPackaged) {
            const userDataPath = path.join(this.getDevTempDir(), "userData-dev");
            this.electronApp.setPath("userData", userDataPath);
            this.logger.info(`[App] Setting up dev userData path: ${userDataPath}`);
        }
    }

    private configureCdp(): void {
        const cdp = this.commandLine.cdp;
        if (!cdp.enabled) {
            return;
        }

        if (!this.isDevMode()) {
            this.logger.warn("[CDP] Ignoring --cdp because it is only available in development mode.");
            return;
        }

        if (cdp.error) {
            this.logger.warn(`[CDP] ${cdp.error}. CDP was not enabled.`);
            return;
        }

        this.electronApp.commandLine.appendSwitch("remote-debugging-port", String(cdp.port));
        this.logger.info(`[CDP] Enabled on port ${cdp.port}.`);
    }

    private async prepare(): Promise<void> {
        if (this.initialized) {
            return;
        }

        if (!this.electronApp && !app) {
            throw new Error("Electron App is not available");
        }

        // Initialize managers
        this.windowManager.initialize();
        this.protocolManager.initialize();
        this.menuManager.initialize();
        this.storageManager.initialize();
        this.pluginPermissionManager.initialize();
        this.pluginManager.initialize();

        if (this.isDevMode()) {
            this.logger.info("App is running in development mode");
            void this.setupDevReloadSocket();
        }

        await this.electronApp.whenReady();

        // Retrieve app info
        this.appInfo = await this.constructAppInfo();
        this.configurePlatformAppIcon();

        this.initialized = true;
        this.logger.info("App initialization completed");

        this.emit(BaseApp.Events.Ready);
    }

    private failBootstrap(error: unknown): void {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.readyError = normalized;
        this.emit(BaseApp.Events.ReadyFailed, normalized);
        this.crash(normalized);
    }

    /**
     * Connect to the development reload server. Failures are never fatal:
     * a missing dev server only disables auto-reload.
     */
    private async setupDevReloadSocket(): Promise<void> {
        try {
            const { WebSocket } = await import("ws");
            const ws = new WebSocket("ws://localhost:5588");
            ws.onerror = (event) => {
                this.logger.warn("[Dev] Reload server not reachable; auto-reload disabled.", event.message);
            };
            ws.onmessage = (event) => {
                const target = this.parseDevReloadTarget(event.data);
                this.windowManager.getWindows().forEach((w) => {
                    if (w.isClosed()) {
                        return;
                    }
                    if (target === "workspace" && w.getWindowType() !== WindowAppType.Workspace) {
                        return;
                    }
                    // Avoid interrupting an in-flight navigation which causes ERR_ABORTED
                    try {
                        const wc = w.getWebContents();
                        if (!wc.isLoadingMainFrame()) {
                            w.reload();
                        }
                    } catch (_e) {
                        // Window might be destroyed; ignore
                    }
                });
            };
        } catch (error) {
            this.logger.warn("[Dev] Failed to set up reload socket:", error);
        }
    }

    private parseDevReloadTarget(data: unknown): "all" | "workspace" {
        const text = typeof data === "string"
            ? data
            : Buffer.isBuffer(data)
              ? data.toString("utf-8")
              : "";
        if (!text || text === "reload") {
            return "all";
        }

        try {
            const parsed = JSON.parse(text) as { target?: unknown };
            return parsed.target === "workspace" ? "workspace" : "all";
        } catch {
            return "all";
        }
    }

    private async constructAppInfo(): Promise<AppInfo> {
        const pkg = await readJson<{ version: string }>(path.resolve(this.getAppPath(), "package.json"));
        if (!pkg.ok) {
            throw new Error(`Failed to load app info: ${pkg.error}`);
        }

        return {
            version: pkg.data.version,
        };
    }

    private configurePlatformAppIcon(): void {
        const dockIconPath = this.getDockIconPath();
        if (!dockIconPath) {
            return;
        }

        this.electronApp.dock?.setIcon(dockIconPath);
    }

    private resolveExistingResource(...filenames: string[]): string | null {
        for (const filename of filenames) {
            const resourcePath = this.resolveResource(filename);
            if (fs.existsSync(resourcePath)) {
                return resourcePath;
            }
        }

        this.logger.warn(`[App] No matching icon resource found for: ${filenames.join(", ")}`);
        return null;
    }

    private emit<K extends StringKeyOf<AppEvents>>(event: K, ...args: AppEvents[K]): void {
        this.events.emit(event, ...args as any);
    }
}
