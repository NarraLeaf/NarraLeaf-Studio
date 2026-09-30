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
    /**
     * Windows that have started closing and are not gone yet, by webContents id.
     *
     * A window comes off {@link windows} and {@link byWebContentsId} the moment it starts closing,
     * so that nothing goes on treating it as open. Its page, though, is still running, and this is
     * exactly when it runs its last code: `beforeunload` and `unload` are dispatched after `close`.
     * Those handlers are where a game writes out what it has not written yet - the playtime clock
     * flushes there - and a write sent from them used to reach a registry that had already
     * forgotten its window and be refused. In Dev Mode that was every second of playtime since the
     * last whole minute, on every close. The channels that exist to land such a write look here;
     * see `IPCHandler.servesClosingWindow`.
     */
    private readonly closingByWebContentsId = new Map<number, AppWindow>();
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
            sender => this.getClosingWindowByWebContents(sender),
        );
        this.registry.initialize(createDefaultIPCHandlers());
    }

    public registerWindow(win: AppWindow): void {
        this.windows.push(win);
        this.byWebContentsId.set(win.getWebContents().id, win);
        this.events.emit("window-created", win);
    }

    /** Forget a window entirely: as open, and as closing. Idempotent. */
    public unregisterWindow(win: AppWindow): void {
        this.app.storageManager.revokeWindowFileSystemAccess(win);
        this.app.menuManager.forgetWindow(win);
        this.windows = this.windows.filter(w => w !== win);
        for (const map of [this.byWebContentsId, this.closingByWebContentsId]) {
            for (const [id, mapped] of map) {
                if (mapped === win) {
                    map.delete(id);
                }
            }
        }
    }

    /**
     * Forget a window as open at the moment it starts closing, and keep it reachable as a closing
     * window until {@link unregisterWindow} is called for it once it is gone. See
     * {@link closingByWebContentsId}.
     */
    public unregisterClosingWindow(win: AppWindow): void {
        this.unregisterWindow(win);
        if (!win.isClosed()) {
            this.closingByWebContentsId.set(win.getWebContents().id, win);
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

    /** The window behind a webContents that has started closing and is not gone yet. */
    public getClosingWindowByWebContents(sender: Electron.WebContents): AppWindow | undefined {
        return this.closingByWebContentsId.get(sender.id);
    }

    /**
     * The window behind a webContents id, or undefined once it has been unregistered.
     *
     * By id rather than by `WebContents` for the callers that only ever held the id: a storage
     * grant remembers the number of the window it was minted for, and the protocol handler that
     * serves it has to find that window again to ask what its project is allowed to do.
     */
    public getWindowByWebContentsId(webContentsId: number): AppWindow | undefined {
        return this.byWebContentsId.get(webContentsId);
    }
}
