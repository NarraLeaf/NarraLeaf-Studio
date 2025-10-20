import { AppEventToken } from "@shared/types/app";
import { Namespace } from "@shared/types/ipc";
import { IPCEventType } from "@shared/types/ipcEvents";
import { App } from "@/app/app";
import { IPCHandler } from "./handlers/IPCHandler";
import { WindowEventManager } from "./windowEvents";
import { WindowInstanceConfig, WindowInstance } from "./windowInstance";
import { WindowIPC } from "./windowIPC";
import { WindowProxy } from "./windowProxy";
import { WindowUserHandlers } from "./windowUserHandlers";
import { WindowProps, WindowAppType, WindowVisibilityStatus } from "@shared/types/window";

export interface WindowConfig {
    isolated: boolean;
    autoFocus: boolean;
    preload: string | null;
    options?: Electron.BrowserWindowConstructorOptions;
}

export class AppWindow<T extends WindowAppType = any> extends WindowProxy {
    public static readonly DefaultConfig: WindowConfig = {
        isolated: true,
        autoFocus: true,
        preload: null,
        options: {
            backgroundColor: "#fff",
        }
    }

    private props: WindowProps[T];

    constructor(app: App, config: Partial<WindowConfig>, props: WindowProps[T]) {
        const instanceConfig: WindowInstanceConfig = {
            isolated: config.isolated ?? AppWindow.DefaultConfig.isolated,
            preload: config.preload ?? AppWindow.DefaultConfig.preload,
            options: config.options ?? AppWindow.DefaultConfig.options,
        };

        const instance = new WindowInstance(instanceConfig);
        const ipc = new WindowIPC(Namespace.NarraLeafStudio);
        const events = new WindowEventManager();
        const userHandlers = new WindowUserHandlers(app.logger);

        super(app, instance, ipc, events, userHandlers);
        this.props = props;

        this.initialize(app);
    }

    // Window Event Handling
    public registerIPCHandler<T extends IPCEventType>(handler: IPCHandler<T>): void {
        this.getIPC().registerHandler(this, handler);
    }

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

    public isClosed(): boolean {
        return this.getBrowserWindow().isDestroyed();
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

    public registerPreloadScript(script: string): string {
        return this.win.webContents.session.registerPreloadScript({
            type: "frame",
            filePath: script,
        })
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

    public getControl(): WindowVisibilityStatus {
        if (this.getBrowserWindow().isMinimized()) {
            return "minimized";
        } else if (this.getBrowserWindow().isMaximized()) {
            return "maximized";
        } else {
            return "normal";
        }
    }

    private initialize(_app: App): void {
        this.app.windowManager.registerWindow(this);
        this.app.windowManager.registerDefaultIPCHandlers(this);

        this.prepareEvents();
    }

    private prepareEvents(): void {
        const win = this.getInstance().getBrowserWindow();
        
        win.on("close", () => {
            this.getEvents().emit("close");

            this.getApp().windowManager.unregisterWindow(this);
        });

        win.webContents.on("render-process-gone", (_event, details) => {
            if (!details.reason || details.reason === "clean-exit") {
                return;
            }
            this.getEvents().emit("render-process-gone", details.reason, `Exit Code: ${details.exitCode}`);
        });
    }

    // Getters
    public get win() {
        return this.getInstance().getBrowserWindow();
    }

    public get app(): App {
        return this.getApp();
    }
}

