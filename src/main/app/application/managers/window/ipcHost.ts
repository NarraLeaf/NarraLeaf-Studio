import {IPC, IPCType, OnlyMessage, OnlyRequest, SubNamespace} from "@shared/types/ipc";
import {IPCEvents, RequestStatus} from "@shared/types/ipcEvents";
import {ipcMain} from "electron";
import { AppEventToken } from "@shared/types/app";

export interface IPCWindow {
    getWebContents(): Electron.WebContents;
    isDestroyed(): boolean;
}

export class IPCHost extends IPC<IPCEvents, IPCType.Host> {
    private static handling: Record<string, boolean> = {};
    private static events: {
        [key: string]: Array<{
            handler: (data: any, resolve: (response: Exclude<any, never>) => void) => void,
            win: IPCWindow
        }>
    } = {};
    private static listeners: {
        [key: string]: Array<{
            token: AppEventToken,
            win: IPCWindow
        }>
    } = {};

    /**
     * Remove all request & message listeners that belong to the specified window
     * and clean up any ipcMain handlers/listeners if no listeners remain.
     */
    public static unregisterWindow(win: IPCWindow): void {
        // Clean request handlers stored in events map
        for (const ns of Object.keys(IPCHost.events)) {
            IPCHost.events[ns] = IPCHost.events[ns].filter(listenerObj => listenerObj.win !== win);

            if (IPCHost.events[ns].length === 0) {
                delete IPCHost.events[ns];
                if (IPCHost.handling[ns]) {
                    delete IPCHost.handling[ns];
                    try {
                        ipcMain.removeHandler(ns);
                    } catch {
                        /* ignore */
                    }
                }
            }
        }

        // Clean message listeners stored in listeners map and remove ipcMain listeners when empty
        for (const eventName of Object.keys(IPCHost.listeners)) {
            const leftover = IPCHost.listeners[eventName].filter(listenerObj => {
                if (listenerObj.win === win) {
                    listenerObj.token.cancel();
                    return false;
                }
                return true;
            });

            if (leftover.length === 0) {
                // remove all ipcMain listeners for this event name
                ipcMain.removeAllListeners(eventName);
                delete IPCHost.listeners[eventName];
            } else {
                IPCHost.listeners[eventName] = leftover;
            }
        }
    }

    static handle<K extends keyof OnlyRequest<IPCEvents, IPCType.Host>>(
        namespace: string,
        win: IPCWindow,
        listener: (
            data: IPCEvents[K]["data"],
            resolve: (response: Exclude<IPCEvents[K]["response"], never>) => void
        ) => Promise<void>
    ): AppEventToken {
        if (!IPCHost.handling[namespace]) {
            IPCHost.handling[namespace] = true;
            ipcMain.handle(namespace, async (event, data) => {
                return await IPCHost.emitHandlerBySender(event.sender, namespace, data);
            });
        }
        if (!IPCHost.events[namespace]) {
            IPCHost.events[namespace] = [];
        } else if (IPCHost.events[namespace].findIndex(listenerObj => listenerObj.win === win) !== -1) {
            console.warn(`Duplicate listener for IPC request: ${namespace}`);
        }
        IPCHost.events[namespace].push({
            handler: listener,
            win
        });

        return {
            cancel: () => {
                const index = IPCHost.events[namespace].findIndex(listenerObj => listenerObj.win === win);
                if (index !== -1) {
                    IPCHost.events[namespace].splice(index, 1);
                }
            }
        };
    }

    static off<K extends keyof OnlyMessage<IPCEvents, IPCType.Host>>(namespace: string, listener: (data: IPCEvents[K]["data"]) => void): void {
        const index = IPCHost.events[namespace].findIndex(listenerObj => listenerObj.handler === listener);
        if (index !== -1) {
            IPCHost.events[namespace].splice(index, 1);
        }
    }

    static emitHandlerBySender<K extends keyof OnlyRequest<IPCEvents, IPCType.Host>>(sender: Electron.WebContents, namespace: string, data: IPCEvents[K]["data"]): Promise<IPCEvents[K]["response"]> {
        return new Promise(resolve => {
            for (const listener of IPCHost.events[namespace] ?? []) {
                if (listener.win.isDestroyed()) {
                    throw new Error(`Window is destroyed. Tried to invoke handler for ${namespace}. (emitHandlerBySender)`);
                }
                if (listener.win.getWebContents() !== sender) {
                    continue;
                }
                console.info(`[IPC] Invoking listener for ${namespace}`);
                listener.handler(data, (data: IPCEvents[K]["response"]) => {
                    resolve(data);
                });
                return;
            }

            throw new Error(`Unhandled IPC request: ${namespace}`);
        });
    }

    constructor(namespace: string) {
        super(IPCType.Host, namespace);
    }

    invoke<K extends keyof OnlyRequest<IPCEvents, IPCType.Host>>(
        win: IPCWindow,
        key: K,
        data: IPCEvents[K]["data"]
    ): Promise<Exclude<IPCEvents[K]["response"], never>> {
        if (win.isDestroyed()) {
            throw new Error(`Window is destroyed. Tried to invoke IPC request: ${this.getEventName(key)}. (invoke)`);
        }
        win.getWebContents().send(this.getEventName(key), data);
        return new Promise(resolve => {
            const handler = (event: Electron.IpcMainEvent, response: Exclude<IPCEvents[K]["response"], never>) => {
                if (win.isDestroyed() || event.sender !== win.getWebContents()) {
                    return;
                }
                resolve(response);
                ipcMain.removeListener(this.getEventName(key, SubNamespace.Reply), handler);
            };
            ipcMain.once(this.getEventName(key, SubNamespace.Reply), handler);
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

    onMessage<K extends keyof OnlyMessage<IPCEvents, IPCType.Host>>(
        win: IPCWindow,
        key: K,
        listener: (data: IPCEvents[K]["data"]) => void
    ): AppEventToken {
        if (win.isDestroyed()) {
            throw new Error(`Window is destroyed. Tried to register IPC event listener: ${this.getEventName(key)}. (onMessage)`);
        }

        const listenerFn = (event: Electron.IpcMainEvent, data: IPCEvents[K]["data"]) => {
            if (win.isDestroyed()) {
                throw new Error(`Possible memory leak. Trying to invoke listener for ${this.getEventName(key)} on a destroyed window.`);
            }
            if (event.sender !== win.getWebContents()) {
                return;
            }
            listener(data);
        };

        const token: AppEventToken = {
            cancel: () => {
                ipcMain.removeListener(this.getEventName(key), listenerFn);
            }
        };
        const eventName = this.getEventName(key);
        if (!IPCHost.listeners[eventName]) {
            IPCHost.listeners[eventName] = [];
        }
        IPCHost.listeners[eventName].push({
            token,
            win
        });
        ipcMain.on(this.getEventName(key), listenerFn);

        return token;
    }

    onRequest<K extends keyof OnlyRequest<IPCEvents, IPCType.Host>>(
        win: IPCWindow,
        key: K,
        listener: (data: IPCEvents[K]["data"]) => Promise<RequestStatus<Exclude<IPCEvents[K]["response"], never>>>
    ): AppEventToken {
        return IPCHost.handle(this.getEventName(key), win, async (data, resolve) => {
            resolve(await listener(data));
        });
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
