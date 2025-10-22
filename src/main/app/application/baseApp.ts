// Electron
import { app } from "electron/main";

// Utils
import EventEmitter from "events";
import { Logger } from "@shared/utils/logger";
import { Platform, PlatformInfo } from "@shared/types/os";

// Managers
import { WindowManager } from "./managers/windowManager";
import path from "path";
import { StringKeyOf } from "@shared/utils/types";
import { ProtocolManager } from "./managers/protocolManager";
import { AppEventToken, AppInfo } from "@shared/types/app";
import { safeExecuteFn } from "@shared/utils/os";
import { WindowAppType } from "@shared/types/window";
import { MenuManager } from "./managers/menuManager";
import { StorageManager } from "./managers/storageManager";
import { readJson } from "@shared/utils/json";
import { PersistentState } from "./storage/persistentState";
import { PERSISTENT_STATE_DEFAULT_DB_NAME, UserDataNamespace } from "@shared/types/constants";
import { createGlobalStateManager, GlobalStateManager } from "./storage/globalState";

export interface AppDependencies {
    protocolManager: ProtocolManager;
    windowManager: WindowManager;
    storageManager: StorageManager;
}
export interface BaseAppConfig { }

export type AppEvents = {
    "ready": [];
};

export class BaseApp {
    public static Events = {
        Ready: "ready"
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

    private initialized: boolean = false;
    protected appInfo: AppInfo | null = null;

    private globalState: GlobalStateManager | null = null;

    constructor(config: BaseAppConfig) {
        this.config = config;
        this.electronApp = app;
        this.platform = Platform.getInfo(process, this.electronApp.isPackaged);
        this.logger = new Logger("MainProcess");
        this.events = new EventEmitter();

        this.setupUserDataDir();

        this.protocolManager = new ProtocolManager(this);
        this.windowManager = new WindowManager(this);
        this.menuManager = new MenuManager(this);
        this.storageManager = new StorageManager(this);

        this.prepare();
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
        return new Promise((resolve) => {
            this.events.once(BaseApp.Events.Ready, () => {
                resolve();
            });
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

    public getDistDir(): string {
        return path.resolve(this.getAppPath(), "dist");
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

    public crash(error: string): void {
        /* TODO: Implement crash handling */
    }

    public isDevMode(): boolean {
        return process.argv.includes("--dev");
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

    private async prepare() {
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

        // Initialize global state
        this.globalState = createGlobalStateManager(this.getUserDataDir());
        await this.globalState.ready();

        this.electronApp.whenReady().then(async () => {
            // Retrieve app info
            this.appInfo = await this.constructAppInfo();

            this.initialized = true;
            this.logger.info("App initialization completed");

            this.emit(BaseApp.Events.Ready);
        });

        if (this.isDevMode()) {
            // Listen for reload events from the development server
            this.logger.info("App is running in development mode");

            const { WebSocket } = await import("ws");
            const ws = new WebSocket("ws://localhost:5588");
            ws.onmessage = () => {
                this.windowManager.getWindows().forEach((w) => {
                    w.reload();
                });
            };
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

    private emit<K extends StringKeyOf<AppEvents>>(event: K, ...args: AppEvents[K]): void {
        this.events.emit(event, ...args as any);
    }
}
