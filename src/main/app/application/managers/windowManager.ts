import { EventEmitter } from "events";
import path from "path";
import { AppWindow, WindowConfig } from "./window/appWindow";
import { AppInfoHandler } from "./window/handlers/appInfo";
import { App } from "@/app/app";
import { AppTerminateHandler } from "./window/handlers/appAction";

type WindowManagerEvents = {
    "window-created": [window: AppWindow];
    "window-ready": [window: AppWindow];
}

export class WindowManager {
    private windows: AppWindow[] = [];

    public events: EventEmitter<WindowManagerEvents>;

    constructor(
        private app: App,
    ) {
        this.events = new EventEmitter();
    }

    public initialize(): void {
    }

    public registerWindow(win: AppWindow): void {
        this.windows.push(win);
    }

    public unregisterWindow(win: AppWindow): void {
        this.windows = this.windows.filter(w => w !== win);
    }

    public getWindows(): AppWindow[] {
        return this.windows;
    }

    public registerDefaultIPCHandlers(win: AppWindow): void {
        win.registerIPCHandler(new AppInfoHandler());
        win.registerIPCHandler(new AppTerminateHandler());
    }
} 