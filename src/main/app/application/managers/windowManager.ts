import { EventEmitter } from "events";
import { BaseApp } from "../baseApp";
import { AppWindow } from "./window/appWindow";
import { AppTerminateHandler, AppWindowControlHandler, AppWindowGetControlHandler } from "./window/handlers/appAction";
import { AppInfoHandler } from "./window/handlers/appInfo";

type WindowManagerEvents = {
    "window-created": [window: AppWindow];
    "window-ready": [window: AppWindow];
}

export class WindowManager {
    private windows: AppWindow[] = [];

    public events: EventEmitter<WindowManagerEvents>;

    constructor(
        private app: BaseApp,
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
        win.registerIPCHandler(new AppWindowControlHandler());
        win.registerIPCHandler(new AppWindowGetControlHandler());
        win.registerIPCHandler(new AppTerminateHandler());
    }
} 