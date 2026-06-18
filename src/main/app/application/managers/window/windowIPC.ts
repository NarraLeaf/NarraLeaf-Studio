import { IPCEventType } from "@shared/types/ipcEvents";
import { IPCMessageType, Namespace } from "@shared/types/ipc";
import { IPCHandler } from "./handlers/IPCHandler";
import { IPCHost } from "./ipcHost";
import { getDeniedApiCapability } from "./permissions";
import type { AppWindow } from "./appWindow";

export class WindowIPC {
    private ipc: IPCHost;

    constructor(namespace: Namespace) {
        this.ipc = new IPCHost(namespace);
    }

    public registerHandler<T extends IPCEventType>(window: AppWindow, handler: IPCHandler<T>): void {
        if (handler.type === IPCMessageType.request) {
            this.ipc.onRequest<T>(window, handler.name, async (data) => {
                const deniedCapability = getDeniedApiCapability(window, handler.requiredApiCapabilities);
                if (deniedCapability) {
                    return this.ipc.failed(new Error(`API permission denied: ${deniedCapability}`));
                }
                try {
                    const handled = await handler.handle(window, data);
                    return handled;
                } catch (error) {
                    return this.ipc.failed(error);
                }
            });
        } else {
            this.ipc.onMessage(window, handler.name, (data) => {
                const deniedCapability = getDeniedApiCapability(window, handler.requiredApiCapabilities);
                if (deniedCapability) {
                    console.warn(`Blocked IPC message ${handler.name}: API permission denied: ${deniedCapability}`);
                    return;
                }
                handler.handle(window, data);
            });
        }
    }

    public getIPCHost(): IPCHost {
        return this.ipc;
    }
} 
