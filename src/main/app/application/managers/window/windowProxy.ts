import { IPCEventType, IPCEvents } from "@shared/types/ipcEvents";
import { App } from "@/app/app";
import { IPCWindow } from "./ipcHost";
import { WindowUserHandlers } from "./windowUserHandlers";
import { WindowInstance } from "./windowInstance";
import { WindowIPC } from "./windowIPC";
import { WindowEventManager } from "./windowEvents";
import { BrowserWindow } from "electron/main";

export class WindowProxy implements IPCWindow {
    constructor(
        protected readonly mainApp: App,
        protected readonly instance: WindowInstance,
        protected readonly ipc: WindowIPC,
        protected readonly events: WindowEventManager,
        protected readonly userHandlers: WindowUserHandlers
    ) {}

    // Application Related
    public getApp(): App {
        return this.mainApp;
    }

    // Internal Accessors (for internal implementation)
    protected getInstance(): WindowInstance {
        return this.instance;
    }

    protected getIPC(): WindowIPC {
        return this.ipc;
    }

    protected getEvents(): WindowEventManager {
        return this.events;
    }

    protected getUserHandlers(): WindowUserHandlers {
        return this.userHandlers;
    }

    public getWebContents(): Electron.WebContents {
        return this.instance.getWebContents();
    }

    public getBrowserWindow(): BrowserWindow {
        return this.instance.getBrowserWindow();
    }

    public handleUserEvent<Request, Response>(event: string, handler: (payload: Request) => Promise<Response> | Response): void {
        this.getUserHandlers().handle(event, handler);
    }

    public invokeUserEvent<Request, Response>(event: string, payload: Request): Promise<Response> | Response {
        return this.getUserHandlers().invoke(event, payload);
    }

    public isUserEventHandled(event: string): boolean {
        return this.getUserHandlers().isHandled(event);
    }

    public offUserEvent(event: string): void {
        this.getUserHandlers().off(event);
    }

    public sendIpcEvent<T extends IPCEventType>(event: T, data: IPCEvents[T]["data"]): void {
        this.ipc.getIPCHost().send(this, event, data);
    }
} 