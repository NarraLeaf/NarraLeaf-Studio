import { IPCMessageType, Namespace } from "@shared/types/ipc";
import { IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import {
    WINDOW_PROJECT_MISMATCH_CODE,
    WINDOW_SERVER_OFF_LIMITS_CODE,
    WINDOW_SIGN_IN_UNUSED_CODE,
} from "@shared/types/window";
import { reportWindowProjectRefusal, type WindowRefusalReason } from "../../utils/windowProjectRefusal";
import { IPCHandler } from "./handlers/IPCHandler";
import { IPCHost } from "./ipcHost";
import { getDeniedApiCapability } from "./permissions";
import type { AppWindow } from "./appWindow";

/**
 * The refusal codes the registry reports on, and what each is reported as.
 *
 * A code rather than a class or a sentence, because the code is what survives the trip through
 * `RequestStatus` - and a refusal raised in a handler file nobody here has read is still recognised.
 */
const WINDOW_REFUSALS: ReadonlyMap<string, WindowRefusalReason> = new Map<string, WindowRefusalReason>([
    [WINDOW_PROJECT_MISMATCH_CODE, "project"],
    [WINDOW_SIGN_IN_UNUSED_CODE, "sign-in-unused"],
    [WINDOW_SERVER_OFF_LIMITS_CODE, "server-off-limits"],
]);

/**
 * Process-wide IPC handler registry.
 *
 * Handlers are stateless, so each event gets exactly one ipcMain registration
 * for the whole app lifetime. Incoming requests/messages are routed to the
 * AppWindow that owns the sender webContents; per-window API-capability
 * checks run after routing. Requests arriving from an unknown or destroyed
 * window (e.g. during shutdown) resolve as a clean failure instead of
 * hanging or throwing.
 *
 * A window that has started closing is neither: it is off the open list, but
 * its page is still running its unload handlers. Only the handlers that declare
 * `servesClosingWindow` answer it; to every other channel it is gone.
 */
export class IPCRegistry {
    private readonly ipc: IPCHost;
    private initialized = false;

    constructor(
        namespace: Namespace,
        private readonly resolveWindow: (sender: Electron.WebContents) => AppWindow | undefined,
        private readonly resolveClosingWindow: (sender: Electron.WebContents) => AppWindow | undefined = () => undefined,
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
            const window = this.resolveLiveWindow(sender, handler);
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
            const window = this.resolveLiveWindow(sender, handler);
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
     * Report a refusal raised by `requireWindowProject`, or by the Team channels' check of which
     * window may speak to a server as the account, wherever it was raised.
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
        if (!result || result.success !== false || typeof result.code !== "string") {
            return;
        }
        const reason = WINDOW_REFUSALS.get(result.code);
        if (reason !== undefined) {
            reportWindowProjectRefusal(window, request, reason);
        }
    }

    private resolveLiveWindow(sender: Electron.WebContents, handler: IPCHandler<IPCEventType>): AppWindow | undefined {
        const window = this.resolveWindow(sender)
            ?? (handler.servesClosingWindow ? this.resolveClosingWindow(sender) : undefined);
        if (!window || window.isDestroyed()) {
            return undefined;
        }
        return window;
    }
}
