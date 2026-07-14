import { IPCMessageType, Namespace } from "@shared/types/ipc";
import { IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { IPCHandler } from "./handlers/IPCHandler";
import { IPCHost } from "./ipcHost";
import { getDeniedApiCapability } from "./permissions";
import type { AppWindow } from "./appWindow";

/**
 * Process-wide IPC handler registry.
 *
 * Handlers are stateless, so each event gets exactly one ipcMain registration
 * for the whole app lifetime. Incoming requests/messages are routed to the
 * AppWindow that owns the sender webContents; per-window API-capability
 * checks run after routing. Requests arriving from an unknown or destroyed
 * window (e.g. during shutdown) resolve as a clean failure instead of
 * hanging or throwing.
 */
export class IPCRegistry {
    private readonly ipc: IPCHost;
    private initialized = false;

    constructor(
        namespace: Namespace,
        private readonly resolveWindow: (sender: Electron.WebContents) => AppWindow | undefined,
    ) {
        this.ipc = new IPCHost(namespace);
    }

    /** Register all handlers globally. Call once at app startup. */
    public initialize(handlers: IPCHandler<IPCEventType>[]): void {
        if (this.initialized) {
            throw new Error("IPCRegistry is already initialized");
        }
        this.initialized = true;

        const seen = new Set<IPCEventType>();
        for (const handler of handlers) {
            if (seen.has(handler.name)) {
                throw new Error(`Duplicate IPC handler for event: ${handler.name}`);
            }
            seen.add(handler.name);

            if (handler.type === IPCMessageType.request) {
                this.registerRequest(handler);
            } else {
                this.registerMessage(handler);
            }
        }
    }

    private registerRequest(handler: IPCHandler<IPCEventType>): void {
        this.ipc.handleGlobal(handler.name as never, async (sender, data): Promise<RequestStatus<unknown>> => {
            const window = this.resolveLiveWindow(sender);
            if (!window) {
                return this.ipc.failed(new Error(`No live window for IPC request: ${handler.name}`));
            }
            const deniedCapability = getDeniedApiCapability(window, handler.requiredApiCapabilities);
            if (deniedCapability) {
                return this.ipc.failed(new Error(`API permission denied: ${deniedCapability}`));
            }
            try {
                return await handler.handle(window, data);
            } catch (error) {
                return this.ipc.failed(error);
            }
        });
    }

    private registerMessage(handler: IPCHandler<IPCEventType>): void {
        this.ipc.onMessageGlobal(handler.name as never, (sender, data) => {
            const window = this.resolveLiveWindow(sender);
            if (!window) {
                console.warn(`Dropped IPC message ${handler.name}: no live window for sender`);
                return;
            }
            const deniedCapability = getDeniedApiCapability(window, handler.requiredApiCapabilities);
            if (deniedCapability) {
                console.warn(`Blocked IPC message ${handler.name}: API permission denied: ${deniedCapability}`);
                return;
            }
            void handler.handle(window, data);
        });
    }

    private resolveLiveWindow(sender: Electron.WebContents): AppWindow | undefined {
        const window = this.resolveWindow(sender);
        if (!window || window.isDestroyed()) {
            return undefined;
        }
        return window;
    }
}
