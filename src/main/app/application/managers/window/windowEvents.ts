import { EventEmitter } from "events";
import { AppEventToken } from "@shared/types/app";
import { StringKeyOf } from "@shared/utils/types";
import type { AppWindow } from "./appWindow";

type WindowEventTypes = {
    /**
     * Emitted when the window is requested to be closed
     */
    "close": [window: AppWindow];
    /**
     * Emitted when the render process of the window is gone
     * @param reason - The reason for the render process to be gone
     * @param detail - The detail of the render process to be gone
     */
    "render-process-gone": [window: AppWindow, reason: string, detail: string];
    /**
     * Emitted when the window is ready and the react app finished its first render
     */
    "ready": [window: AppWindow];
    /**
     * Emitted when the window is closed due to the user or renderer process termination
     */
    "closed": [window: AppWindow];
};

export class WindowEventManager {
    private events: EventEmitter<WindowEventTypes> = new EventEmitter<WindowEventTypes>();
    /** Whether `close` has been emitted. See {@link emitClosed}. */
    private closeEmitted = false;

    public onClose(fn: () => void): AppEventToken {
        const handler = () => {
            fn();
        };
        this.events.on("close", handler);
        return {
            cancel: () => {
                this.events.removeListener("close", handler);
            }
        };
    }

    public onReady(fn: () => void): AppEventToken {
        const handler = () => {
            fn();
        };
        this.events.on("ready", handler);
        return {
            cancel: () => {
                this.events.removeListener("ready", handler);
            }
        };
    }

    public onEvent<Request, Response>(event: string, fn: (payload: Request) => Promise<Response> | Response): AppEventToken {
        const handler = (payload: Request) => {
            const result = fn(payload);
            if (result instanceof Promise) {
                return result;
            }
            return Promise.resolve(result);
        };

        this.events.on(event as any, handler);
        return {
            cancel: () => {
                this.events.removeListener(event as any, handler);
            }
        };
    }

    public emit<K extends StringKeyOf<WindowEventTypes>>(event: K, ...args: WindowEventTypes[K]): void {
        if (event === "close") {
            this.closeEmitted = true;
        }
        this.events.emit(event, ...args as any);
    }

    /**
     * Announce that the window is gone, and that it is closing first if nobody heard that yet.
     *
     * A window can go without a close request: `destroy()`, or its page calling `window.close()`,
     * which Electron carries out without a `close` event. Everything subscribed through
     * {@link onClose} is there to hear that the window went away - a Dev Mode session that never
     * heard it went on reporting "running" for a window that no longer existed.
     */
    public emitClosed(window: AppWindow): void {
        if (!this.closeEmitted) {
            this.emit("close", window);
        }
        this.emit("closed", window);
    }

    public onRenderProcessGone(fn: (window: AppWindow, reason: string, detail: string) => void): AppEventToken {
        // Register and cancel the *same* function: the previous version subscribed an inline
        // closure and then tried to remove a different one, so `cancel()` never removed anything.
        const handler = (window: AppWindow, reason: string, detail: string) => {
            fn(window, reason, detail);
        };
        this.events.on("render-process-gone", handler);
        return {
            cancel: () => {
                this.events.removeListener("render-process-gone", handler);
            }
        };
    }
} 