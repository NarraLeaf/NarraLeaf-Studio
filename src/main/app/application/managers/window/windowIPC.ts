import { Namespace } from "@shared/types/ipc";
import { IPCHost } from "./ipcHost";

/**
 * Per-window holder of an IPCHost instance for host-initiated traffic
 * (send / invoke). Incoming renderer requests are handled globally by
 * IPCRegistry — see ipcRegistry.ts.
 */
export class WindowIPC {
    private ipc: IPCHost;

    constructor(namespace: Namespace) {
        this.ipc = new IPCHost(namespace);
    }

    public getIPCHost(): IPCHost {
        return this.ipc;
    }
}
