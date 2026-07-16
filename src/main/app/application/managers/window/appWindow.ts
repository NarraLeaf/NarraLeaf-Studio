import fs from "fs";
import { AppEventToken } from "@shared/types/app";
import { Namespace } from "@shared/types/ipc";
import { App } from "@/app/app";
import { WindowEventManager } from "./windowEvents";
import { WindowInstanceConfig, WindowInstance } from "./windowInstance";
import { WindowIPC } from "./windowIPC";
import { WindowProxy } from "./windowProxy";
import { WindowUserHandlers } from "./windowUserHandlers";
import { WindowProps, WindowAppType, WindowVisibilityStatus, WindowCloseResults, WindowControlPolicy } from "@shared/types/window";
import { getWindowBackgroundColor } from "@/app/application/theme";
import { decideWindowNavigation } from "./navigationGuard";

export interface WindowConfig<T extends WindowAppType> {
    windowType: T;
    isolated: boolean;
    autoFocus: boolean;
    preload: string | null;
    options?: Electron.BrowserWindowConstructorOptions;
    windowControlPolicy?: WindowControlPolicy;
}

export class AppWindow<T extends WindowAppType = any> extends WindowProxy {
    public static readonly DefaultConfig: WindowConfig<WindowAppType.Raw> = {
        windowType: WindowAppType.Raw,
        isolated: true,
        autoFocus: true,
        preload: null,
    }

    private props: WindowProps[T];
    private children: Set<AppWindow> = new Set();
    private tokens: Map<AppWindow, AppEventToken> = new Map();
    private parent?: AppWindow;
    private closeResult?: WindowCloseResults[T];
    private closeResultResolver?: (result: WindowCloseResults[T]) => void;
    private config: WindowConfig<T>;
    private closeGuard?: (window: AppWindow<T>) => boolean;
    private closeGuardBypassed: boolean = false;

    constructor(app: App, config: WindowConfig<T>, props: WindowProps[T]) {
        const windowConfig: WindowConfig<T> = {
            ...AppWindow.DefaultConfig,
            ...config,
            options: {
                // Paint-behind color for every Studio window, resolved from the
                // current theme at creation time (kept live afterwards by the
                // nativeTheme listener in baseApp).
                backgroundColor: getWindowBackgroundColor(),
                ...config.options,
            },
        } as WindowConfig<T>;

        const instance = new WindowInstance(windowConfig);
        const ipc = new WindowIPC(Namespace.NarraLeafStudio);
        const events = new WindowEventManager();
        const userHandlers = new WindowUserHandlers(app.logger);

        super(app, instance, ipc, events, userHandlers);
        this.props = props;
        this.config = windowConfig;

        this.initialize(app);
    }

    // Window Event Handling
    public onClose(fn: () => void) {
        return this.getEvents().onClose(fn);
    }

    public onEvent<Request, Response>(event: string, fn: (payload: Request) => Promise<Response> | Response) {
        return this.getEvents().onEvent(event, fn);
    }

    // Web Content State Operations
    public isFullScreen(): boolean {
        return this.getBrowserWindow().isFullScreen();
    }

    public enterFullScreen(): void {
        this.getBrowserWindow().setFullScreen(true);
    }

    public exitFullScreen(): void {
        this.getBrowserWindow().setFullScreen(false);
    }

    public reload(): void {
        this.getBrowserWindow().reload();
    }

    // Developer Tools
    public toggleDevTools(): void {
        const webContents = this.getWebContents();
        if (webContents.isDevToolsOpened()) {
            webContents.closeDevTools();
        } else {
            webContents.openDevTools();
        }
    }

    // Window State Operations
    public setIcon(icon: string): void {
        if (process.platform === "darwin") {
            return;
        }

        if (!fs.existsSync(icon)) {
            this.app.logger.warn(`[Window] Icon file not found: ${icon}`);
            return;
        }

        this.getBrowserWindow().setIcon(icon);
    }

    public async show(): Promise<void> {
        return this.getBrowserWindow().show();
    }

    public async loadURL(url: string): Promise<void> {
        return this.getBrowserWindow().loadURL(url);
    }

    public async loadFile(file: string): Promise<void> {
        return this.getBrowserWindow().loadFile(file);
    }

    public setTitle(title: string): void {
        this.getBrowserWindow().setTitle(title);
    }

    public getTitle(): string {
        return this.getBrowserWindow().getTitle();
    }

    public close(): void {
        this.getBrowserWindow().close();
    }

    /**
     * Intercept close requests for this window, whichever way they arrive: the native
     * traffic lights/close box, the renderer's title bar controls, or close() from main.
     *
     * Returning true swallows the close; the guard then owns the window's lifetime and must
     * call forceClose() once it is done. Returning false lets the close proceed. The guard is
     * skipped while the app is quitting, so it can never cancel a quit.
     */
    public setCloseGuard(guard: (window: AppWindow<T>) => boolean): void {
        this.closeGuard = guard;
    }

    /**
     * Close the window, ignoring any close guard. Safe to call after async work: the window may
     * already be gone by then (app quit, crash), in which case this does nothing.
     */
    public forceClose(): void {
        if (this.isClosed()) {
            return;
        }
        this.closeGuardBypassed = true;
        this.close();
    }

    public closeWith(result: WindowCloseResults[T]): void {
        this.closeResult = result;
        this.close();
    }

    public setCloseResultResolver(resolver: (result: WindowCloseResults[T]) => void): void {
        this.closeResultResolver = resolver;
    }

    public getCloseResult(): WindowCloseResults[T] | undefined {
        return this.closeResult;
    }

    public isClosed(): boolean {
        return this.getBrowserWindow().isDestroyed();
    }

    public getWindowType(): WindowAppType {
        return this.getConfig().windowType;
    }

    public onKeyUp(key: KeyboardEvent["key"], fn: (event: Electron.Event, input: Electron.Input) => void): AppEventToken {
        const handler = (event: Electron.Event, input: Electron.Input) => {
            if (input.type === "keyUp" && input.key === key) {
                fn(event, input);
            }
        };

        this.getWebContents().on("before-input-event", handler);
        return {
            cancel: () => {
                this.getWebContents().removeListener("before-input-event", handler);
            }
        };
    }

    public getProps(): WindowProps[T] {
        return this.props;
    }

    public minimize(): void {
        this.getBrowserWindow().minimize();
    }

    public maximize(): void {
        this.getBrowserWindow().maximize();
    }

    public unmaximize(): void {
        this.getBrowserWindow().unmaximize();
    }

    public focus(): void {
        this.getBrowserWindow().focus();
    }

    public getControl(): WindowVisibilityStatus {
        if (this.getBrowserWindow().isMinimized()) {
            return "minimized";
        } else if (this.getBrowserWindow().isMaximized()) {
            return "maximized";
        } else {
            return "normal";
        }
    }

    public announceReady(): void {
        this.getEvents().emit("ready", this);
    }

    public onReady(fn: () => void): AppEventToken {
        return this.getEvents().onReady(fn);
    }

    public showWhenReady(): AppEventToken {
        return this.getEvents().onReady(() => {
            this.show();
        });
    }

    public addChild(child: AppWindow): void {
        if (this.children.has(child)) {
            return;
        }
        this.children.add(child);
        child.parent = this;

        const token = child.getEvents().onEvent("closed", () => {
            this.removeChild(child);
        });
        this.tokens.set(child, token);
    }

    public removeChild(child: AppWindow): void {
        this.children.delete(child);
        child.parent = undefined;

        const token = this.tokens.get(child);
        if (token) {
            token.cancel();
            this.tokens.delete(child);
        }
    }
    
    public getConfig(): WindowConfig<T> {
        return this.config;
    }

    private initialize(_app: App): void {
        this.app.windowManager.registerWindow(this);

        this.prepareEvents();
    }

    private prepareEvents(): void {
        const win = this.getInstance().getBrowserWindow();
        const webContents = win.webContents;

        win.on("close", (event) => {
            if (this.closeGuard && !this.closeGuardBypassed && !this.getApp().isQuitting()) {
                if (this.closeGuard(this)) {
                    event.preventDefault();
                    return;
                }
            }

            this.getEvents().emit("close", this);

            // Resolve close result if resolver is set
            if (this.closeResultResolver) {
                // If closeResult is undefined, pass null (window closed without result)
                this.closeResultResolver(this.closeResult ?? null as WindowCloseResults[T]);
                this.closeResultResolver = undefined;
            }

            this.getApp().windowManager.unregisterWindow(this);
        });

        win.on("closed", () => {
            this.children.forEach(child => {
                child.getBrowserWindow().destroy();
            });

            this.getEvents().emit("closed", this);
            this.getApp().windowManager.emitWindowClosed(this);
            this.getApp().windowManager.unregisterWindow(this);
        });

        webContents.on("will-frame-navigate", (event) => {
            const decision = decideWindowNavigation({
                url: event.url,
                currentUrl: webContents.getURL() || undefined,
                isMainFrame: event.isMainFrame,
                windowType: this.getWindowType(),
                appEntryPath: this.getApp().getAppEntry(this.getWindowType()),
            });
            if (decision.allowed) {
                return;
            }

            event.preventDefault();
            this.getApp().logger.warn(`[Window] Blocked navigation for ${this.getWindowType()}: ${event.url} (${decision.reason})`);
        });

        webContents.setWindowOpenHandler((details) => {
            this.getApp().logger.warn(`[Window] Blocked new window for ${this.getWindowType()}: ${details.url}`);
            return { action: "deny" };
        });

        webContents.on("will-attach-webview", (event, _webPreferences, params) => {
            event.preventDefault();
            this.getApp().logger.warn(`[Window] Blocked webview attachment for ${this.getWindowType()}: ${params.src ?? ""}`);
        });

        webContents.on("render-process-gone", (_event, details) => {
            if (!details.reason || details.reason === "clean-exit") {
                return;
            }
            this.getEvents().emit("render-process-gone", this, details.reason, `Exit Code: ${details.exitCode}`);

            win.destroy();
        });

        this.autoFocus();
    }

    private autoFocus(): void {
        if (this.getConfig().autoFocus) {
            this.getBrowserWindow().focus();
        }
    }

    // Getters
    public get win() {
        return this.getInstance().getBrowserWindow();
    }

    public get app(): App {
        return this.getApp();
    }
}
