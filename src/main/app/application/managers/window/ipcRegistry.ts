import { IPCMessageType, Namespace } from "@shared/types/ipc";
import { IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { WINDOW_PROJECT_MISMATCH_CODE } from "@shared/types/window";
import { reportWindowProjectRefusal } from "../../utils/windowProjectRefusal";
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
                const result = await handler.handle(window, data);
                this.noteProjectRefusal(window, handler.name, result);
                return result;
            } catch (error) {
                const failure = this.ipc.failed(error);
                this.noteProjectRefusal(window, handler.name, failure);
                return failure;
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
            // A message answers nobody, so what a message handler returns is dropped here - but a
            // refusal is exactly the thing that has to survive that. The two forwarding channels
            // are messages and both are guarded, so the outcome is read for that one purpose and
            // then discarded as before.
            void Promise.resolve(handler.handle(window, data)).then(
                result => this.noteProjectRefusal(window, handler.name, result),
                error => this.noteProjectRefusal(window, handler.name, this.ipc.failed(error)),
            );
        });
    }

    /**
     * Report a refusal raised by `requireWindowProject`, wherever it was raised.
     *
     * Read here rather than at each guarded handler, and that is the point: the guard is spreading
     * across the handler files one tranche at a time, and a rule that each of them must also
     * remember to log is a rule that will be half-applied. The registry sees every request and
     * every message, so a channel guarded tomorrow is reported without touching this file.
     *
     * Recognised by the code rather than by the sentence, because prose gets reworded and this is
     * the one refusal in the app that no interface has a remedy for.
     */
    private noteProjectRefusal(window: AppWindow, request: string, result: RequestStatus<unknown> | undefined): void {
        if (result && result.success === false && result.code === WINDOW_PROJECT_MISMATCH_CODE) {
            reportWindowProjectRefusal(window, request);
        }
    }

    private resolveLiveWindow(sender: Electron.WebContents): AppWindow | undefined {
        const window = this.resolveWindow(sender);
        if (!window || window.isDestroyed()) {
            return undefined;
        }
        return window;
    }
}
