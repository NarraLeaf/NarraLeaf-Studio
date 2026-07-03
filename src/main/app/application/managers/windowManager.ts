import { EventEmitter } from "events";
import { Namespace } from "@shared/types/ipc";
import { BaseApp } from "../baseApp";
import { AppWindow } from "./window/appWindow";
import { createDefaultIPCHandlers } from "./window/defaultHandlers";
import { IPCRegistry } from "./window/ipcRegistry";

type WindowManagerEvents = {
    "window-created": [window: AppWindow];
    "window-ready": [window: AppWindow];
    "window-closed": [window: AppWindow];
}

export class WindowManager {
    private windows: AppWindow[] = [];
    private readonly byWebContentsId = new Map<number, AppWindow>();
    private registry: IPCRegistry | null = null;

    public events: EventEmitter<WindowManagerEvents>;

    constructor(
        private app: BaseApp,
    ) {
        this.events = new EventEmitter();
    }

    public initialize(): void {
        // All IPC handlers are stateless and registered once per process;
        // requests are routed to the window owning the sender webContents.
        this.registry = new IPCRegistry(
            Namespace.NarraLeafStudio,
            sender => this.getWindowByWebContents(sender),
        );
        this.registry.initialize(createDefaultIPCHandlers());
    }

    public registerWindow(win: AppWindow): void {
        this.windows.push(win);
        this.byWebContentsId.set(win.getWebContents().id, win);
    }

    public unregisterWindow(win: AppWindow): void {
        this.app.storageManager.revokeWindowFileSystemAccess(win);
        this.windows = this.windows.filter(w => w !== win);
        for (const [id, mapped] of this.byWebContentsId) {
            if (mapped === win) {
                this.byWebContentsId.delete(id);
            }
        }
    }

    public emitWindowClosed(win: AppWindow): void {
        this.events.emit("window-closed", win);
    }

    public getWindows(): AppWindow[] {
        return this.windows;
    }

    public hasWindows(): boolean {
        return this.windows.length > 0;
    }

    public getWindowByWebContents(sender: Electron.WebContents): AppWindow | undefined {
        return this.byWebContentsId.get(sender.id);
    }
}
