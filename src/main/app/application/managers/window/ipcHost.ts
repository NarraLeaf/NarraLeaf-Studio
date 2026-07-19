import {IPC, IPCType, OnlyMessage, OnlyRequest, SubNamespace} from "@shared/types/ipc";
import {IPCEvents, RequestStatus} from "@shared/types/ipcEvents";
import {ipcMain} from "electron";
import crypto from "crypto";

export interface IPCWindow {
    getWebContents(): Electron.WebContents;
    isDestroyed(): boolean;
}

export class IPCHost extends IPC<IPCEvents, IPCType.Host> {
    public static readonly DefaultInvokeTimeoutMs = 10_000;

    constructor(namespace: string) {
        super(IPCType.Host, namespace);
    }

    /**
     * Register a process-wide request handler for this event. Called once per
     * event at app startup; the callback resolves the target window from the
     * sender webContents.
     */
    public handleGlobal<K extends keyof OnlyRequest<IPCEvents, IPCType.Host>>(
        key: K,
        handler: (sender: Electron.WebContents, data: IPCEvents[K]["data"]) => Promise<RequestStatus<any>>,
    ): void {
        ipcMain.handle(this.getEventName(key), (event, data) => handler(event.sender, data));
    }

    /**
     * Register a process-wide message listener for this event. Called once per
     * event at app startup; the callback resolves the target window from the
     * sender webContents.
     */
    public onMessageGlobal<K extends keyof OnlyMessage<IPCEvents, IPCType.Host>>(
        key: K,
        handler: (sender: Electron.WebContents, data: IPCEvents[K]["data"]) => void,
    ): void {
        ipcMain.on(this.getEventName(key), (event, data) => handler(event.sender, data));
    }

    invoke<K extends keyof OnlyRequest<IPCEvents, IPCType.Host>>(
        win: IPCWindow,
        key: K,
        data: IPCEvents[K]["data"],
        options?: { timeoutMs?: number }
    ): Promise<Exclude<IPCEvents[K]["response"], never>> {
        const channel = this.getEventName(key);
        if (win.isDestroyed()) {
            throw new Error(`Window is destroyed. Tried to invoke IPC request: ${channel}. (invoke)`);
        }
        const timeoutMs = options?.timeoutMs ?? IPCHost.DefaultInvokeTimeoutMs;
        const requestId = crypto.randomUUID();
        const replyChannel = this.getEventName(key, SubNamespace.Reply) + "." + requestId;
        const webContents = win.getWebContents();
        webContents.send(channel, data, requestId);
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                ipcMain.removeListener(replyChannel, handler);
                webContents.removeListener("destroyed", onDestroyed);
                clearTimeout(timer);
            };
            const handler = (_event: Electron.IpcMainEvent, response: Exclude<IPCEvents[K]["response"], never>) => {
                cleanup();
                resolve(response);
            };
            const onDestroyed = () => {
                cleanup();
                reject(new Error(`Window closed before replying to IPC request: ${channel}`));
            };
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`IPC invoke timed out after ${timeoutMs}ms: ${channel}`));
            }, timeoutMs);
            ipcMain.once(replyChannel, handler);
            webContents.once("destroyed", onDestroyed);
        });
    }

    send<K extends keyof OnlyMessage<IPCEvents, IPCType.Host>>(
        win: IPCWindow,
        key: K,
        data: IPCEvents[K]["data"]
    ): void {
        if (win.isDestroyed()) {
            throw new Error(`Window is destroyed. Tried to send IPC event: ${this.getEventName(key)}. (send)`);
        }

        return win.getWebContents().send(this.getEventName(key), data);
    }

    public failed<T>(err: unknown): RequestStatus<T> {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }

    public success<T>(data: T): RequestStatus<T>;
    public success(): RequestStatus<void>;
    public success<T = undefined>(data?: T extends undefined ? never : T): RequestStatus<T extends undefined ? void : T> {
        if (data !== undefined) {
            return {
                success: true,
                data,
            };
        }
        return {
            success: true,
            data: undefined as any,
        };
    }

    public async tryUse<T>(exec: () => T | Promise<T>): Promise<RequestStatus<T>> {
        try {
            const data = await exec();
            return this.success(data);
        } catch (err) {
            return this.failed(err);
        }
    }
}
