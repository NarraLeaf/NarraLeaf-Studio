import fs from "fs";
import { AppEventToken } from "@shared/types/app";
import { Namespace } from "@shared/types/ipc";
import { IPCEventType } from "@shared/types/ipcEvents";
import { App } from "@/app/app";
import { WindowEventManager } from "./windowEvents";
import { WindowInstanceConfig, WindowInstance } from "./windowInstance";
import { WindowIPC } from "./windowIPC";
import { WindowProxy } from "./windowProxy";
import { WindowUserHandlers } from "./windowUserHandlers";
import { WindowProps, WindowAppType, WindowVisibilityStatus, WindowCloseResults, WindowControlPolicy } from "@shared/types/window";
import { getWindowBackgroundColor } from "@/app/application/theme";
import { applyTrafficLightPositionForZoom, applyZoomFactorToWebContents, windowTypeUsesZoom } from "@/app/application/zoom";
import { ZOOM_PERCENT_DEFAULT, nextZoomPercent, normalizeZoomPercent, trafficLightPositionForZoom } from "@shared/constants/zoom";
import { decideWindowNavigation } from "./navigationGuard";
import { decideDetachedWindowOpen } from "./detachedWindowGuard";

/**
 * Floor for a detached editor window. Small enough to park beside the workspace on one screen,
 * large enough that the editor inside it still has a canvas next to its side panels.
 */
const DETACHED_WINDOW_MIN_WIDTH = 640;
const DETACHED_WINDOW_MIN_HEIGHT = 420;

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
    /**
     * Popups this window detached part of itself into (see `detachedWindowGuard`), by their key.
     *
     * They are Chromium-owned child windows, not `AppWindow`s, so nothing else in the app iterates
     * over them - this map is what carries window-wide settings (zoom, traffic lights) across, and
     * what `controlDetachedWindow` resolves against, which is also the reason it is scoped to one
     * opener: a window can only drive the popups it opened. Chromium closes them with their opener,
     * hence no teardown here beyond forgetting the entry.
     */
    private detachedWindows: Map<string, Electron.BrowserWindow> = new Map();

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

    /**
     * Change what this window was opened with, for the next load of it.
     *
     * Only meaningful immediately before {@link reload}: props are read once, by the renderer that
     * is starting up, so writing them without reloading changes nothing anybody will look at. The
     * one caller is the recovery-mode switch, which is a reload by definition - it exists to throw
     * away a renderer whose in-memory state cannot be trusted and come back with a different
     * startup path.
     */
    public setProps(props: WindowProps[T]): void {
        this.props = props;
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

    /**
     * Workspace load outcome, reported by the renderer once its project preflight settles
     * (see `workspace.reportLoadResult`). Replace-style launches wait on this instead of
     * `onReady`: a window can be "ready" showing the not-a-project error screen, and closing
     * the opener then would trade a working workspace for a dead end.
     */
    private loadResult: boolean | null = null;
    private loadResultCallbacks: Array<(ok: boolean) => void> = [];

    public reportLoadResult(ok: boolean): void {
        if (this.loadResult !== null) {
            return; // First report wins; the preflight settles exactly once.
        }
        this.loadResult = ok;
        const callbacks = this.loadResultCallbacks;
        this.loadResultCallbacks = [];
        for (const callback of callbacks) {
            callback(ok);
        }
    }

    /** Invoke `fn` with the load outcome - immediately if already reported. */
    public onLoadResult(fn: (ok: boolean) => void): void {
        if (this.loadResult !== null) {
            fn(this.loadResult);
            return;
        }
        this.loadResultCallbacks.push(fn);
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

    /**
     * Drive one of this window's detached popups, and report where it ended up.
     *
     * Keyed rather than implicit because the renderer drawing that popup's buttons is THIS
     * window's - see `appDetachedWindowControl`. Returns null for a key this window did not open,
     * which is both the "window already gone" case and the refusal of a key belonging to someone
     * else.
     */
    public controlDetachedWindow(
        key: string,
        control: "status" | "minimize" | "toggleMaximize" | "close",
    ): WindowVisibilityStatus | null {
        const detached = this.detachedWindows.get(key);
        if (!detached || detached.isDestroyed()) {
            return null;
        }

        switch (control) {
            case "minimize":
                detached.minimize();
                break;
            case "toggleMaximize":
                if (detached.isMaximized()) {
                    detached.unmaximize();
                } else {
                    detached.maximize();
                }
                break;
            case "close":
                detached.close();
                // Reporting the state of a window that is on its way out would be a lie either
                // way; the renderer only uses this to draw a button it is about to unmount.
                return "normal";
            case "status":
                break;
        }

        return detachedWindowStatus(detached);
    }

    /** Re-read `ui.zoomPercent` and apply it. No-op for windows that don't zoom. */
    public applyStoredZoom(): void {
        if (!windowTypeUsesZoom(this.getWindowType())) {
            return;
        }
        const percent = this.getApp().globalState.get("ui.zoomPercent");
        try {
            applyZoomFactorToWebContents(this.getWebContents(), percent);
            // A detached editor is the same interface at a different zoom otherwise: zoom is a
            // per-webContents property and the popup has its own, which no broadcast reaches.
            for (const detached of this.detachedWindows.values()) {
                if (detached.isDestroyed()) {
                    continue;
                }
                applyZoomFactorToWebContents(detached.webContents, percent);
                // Frameless like its opener, and wearing the editor's own title row: the OS-drawn
                // buttons have to be re-centred in a bar that just changed height.
                applyTrafficLightPositionForZoom(detached, WindowControlPolicy.Standard, percent);
            }
            // The traffic lights are drawn by macOS and ignore the zoom, so the CSS
            // titlebar would otherwise grow or shrink out from under them.
            if (this.getConfig().options?.frame === false) {
                applyTrafficLightPositionForZoom(
                    this.getBrowserWindow(),
                    this.getConfig().windowControlPolicy ?? WindowControlPolicy.Standard,
                    percent,
                );
            }
        } catch (error) {
            this.getApp().logger.debug(`[Zoom] Failed to apply zoom to ${this.getWindowType()}: ${String(error)}`);
        }
    }

    /**
     * Keep the window on the stored zoom, and let Cmd/Ctrl +/-/0 change it.
     *
     * The shortcuts write the setting rather than touching this webContents, so
     * one keystroke re-zooms every open window through the same broadcast the
     * Settings window uses. They are wired here (not in the macOS menu) because
     * `buildMenuTemplate` returns an empty menu off darwin, which would leave
     * Windows and Linux without any way to zoom.
     */
    private prepareZoom(webContents: Electron.WebContents): void {
        if (!windowTypeUsesZoom(this.getWindowType())) {
            return;
        }

        // Electron drops the zoom factor on every navigation, so re-apply on load
        // rather than once at construction.
        webContents.on("did-finish-load", () => this.applyStoredZoom());

        webContents.on("before-input-event", (event, input) => {
            if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) {
                return;
            }

            const current = this.getApp().globalState.get("ui.zoomPercent");
            let next: number | null = null;
            // "=" and "+" share a key; the numpad reports "Add"/"Subtract".
            if (input.key === "=" || input.key === "+" || input.key === "Add") {
                next = nextZoomPercent(current, 1);
            } else if (input.key === "-" || input.key === "_" || input.key === "Subtract") {
                next = nextZoomPercent(current, -1);
            } else if (input.key === "0") {
                next = ZOOM_PERCENT_DEFAULT;
            }

            if (next === null) {
                return;
            }

            event.preventDefault();
            if (next === normalizeZoomPercent(current)) {
                return;
            }
            this.getApp().setGlobalStateAndBroadcast("ui.zoomPercent", next);
        });
    }

    private prepareEvents(): void {
        const win = this.getInstance().getBrowserWindow();
        const webContents = win.webContents;

        this.prepareZoom(webContents);

        // The title bar reserves space for the macOS traffic lights, which the OS hides in
        // fullscreen - so the renderer has to know when that happens to reclaim the gap. Pushed
        // rather than polled because Electron's matchMedia change events are unreliable.
        const forwardFullscreen = (isFullscreen: boolean) => () => {
            if (!this.isClosed() && !this.isDestroyed()) {
                this.sendIpcEvent(IPCEventType.appWindowFullscreenChanged, { isFullscreen });
            }
        };
        win.on("enter-full-screen", forwardFullscreen(true));
        win.on("leave-full-screen", forwardFullscreen(false));

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
            const decision = decideDetachedWindowOpen({
                url: details.url,
                frameName: details.frameName,
                windowType: this.getWindowType(),
            });
            if (!decision.allowed) {
                this.getApp().logger.warn(
                    `[Window] Blocked new window for ${this.getWindowType()}: ${details.url} (${decision.reason})`,
                );
                return { action: "deny" };
            }

            return {
                action: "allow",
                // Frameless, like every other Studio window: the detached editor's own title row
                // is the title bar (it carries `titlebar-drag`, reserves the traffic lights their
                // space, and draws the buttons where the OS draws none). The buttons it draws
                // cannot use the ordinary window-control IPC - a popup sends IPC through its
                // opener, so "close this window" would close the workspace - hence
                // `appDetachedWindowControl`, which names the window it means.
                overrideBrowserWindowOptions: {
                    frame: false,
                    ...(process.platform === "darwin"
                        ? {
                            titleBarStyle: "hidden" as const,
                            trafficLightPosition: trafficLightPositionForZoom(
                                this.getApp().globalState.get("ui.zoomPercent"),
                            ),
                        }
                        : {}),
                    backgroundColor: getWindowBackgroundColor(),
                    minWidth: DETACHED_WINDOW_MIN_WIDTH,
                    minHeight: DETACHED_WINDOW_MIN_HEIGHT,
                },
                // Left at the default (false): the popup is a view onto the opener's React tree,
                // so outliving the opener would leave a window whose contents can never update.
                outlivesOpener: false,
            };
        });

        webContents.on("did-create-window", (child, details) => {
            const decision = decideDetachedWindowOpen({
                url: details.url,
                frameName: details.frameName,
                windowType: this.getWindowType(),
            });
            if (!decision.allowed) {
                // Unreachable through the handler above, which is the only way a window gets made;
                // an unkeyed child would be one nothing can address, so refuse rather than keep it.
                this.getApp().logger.error(`[Window] Detached window arrived unkeyed: ${details.frameName}`);
                child.destroy();
                return;
            }

            this.getApp().logger.info(`[Window] Detached window opened from ${this.getWindowType()}: ${details.frameName}`);
            // Held as its own reference: `closed` fires after the BrowserWindow is destroyed, and
            // reading `child.webContents` from there throws "Object has been destroyed" - out of a
            // native event handler, which takes the whole main process down with it.
            const contents = child.webContents;
            this.detachedWindows.set(decision.key, child);
            child.on("closed", () => {
                if (this.detachedWindows.get(decision.key) === child) {
                    this.detachedWindows.delete(decision.key);
                }
            });

            // Same restrictions the parent lives under. A blank popup has no URL to navigate from,
            // but it does have a renderer that could be talked into acquiring one.
            contents.setWindowOpenHandler(() => ({ action: "deny" }));
            contents.on("will-navigate", (event) => event.preventDefault());
            contents.on("will-attach-webview", (event) => event.preventDefault());

            this.applyStoredZoom();
        });

        webContents.on("will-attach-webview", (event, _webPreferences, params) => {
            event.preventDefault();
            this.getApp().logger.warn(`[Window] Blocked webview attachment for ${this.getWindowType()}: ${params.src ?? ""}`);
        });

        // A hung window and a busy one look identical from the outside; the log is the only place
        // the difference is recorded, and "it froze for 40 seconds and came back" is exactly the
        // report that is impossible to act on without a timestamp.
        win.on("unresponsive", () => {
            this.getApp().logger.warn(`[Window] The ${this.getWindowType()} window stopped responding`);
        });
        win.on("responsive", () => {
            this.getApp().logger.info(`[Window] The ${this.getWindowType()} window is responding again`);
        });

        webContents.on("render-process-gone", (_event, details) => {
            if (!details.reason || details.reason === "clean-exit") {
                return;
            }
            // The window is about to be destroyed with no dialog and no trace. Say so somewhere
            // that outlives it - the emitted event below has no subscribers.
            this.getApp().logger.error(
                `[Crash] The ${this.getWindowType()} window's renderer exited: ${details.reason} `
                + `(exit code ${details.exitCode})`,
            );
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

function detachedWindowStatus(window: Electron.BrowserWindow): WindowVisibilityStatus {
    if (window.isMinimized()) {
        return "minimized";
    }
    return window.isMaximized() ? "maximized" : "normal";
}
