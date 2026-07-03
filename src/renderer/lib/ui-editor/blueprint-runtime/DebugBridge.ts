import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";

export type DebugEventListener = () => void;
export type DebugEventObserver = (event: BlueprintDebugEvent) => void;

export const MAX_DEBUG_EVENT_MESSAGE_CHARS = 4096;
export const MAX_DEBUG_EVENT_BUFFER_LENGTH = 2000;
const TRUNCATED_DEBUG_EVENT_MESSAGE_SUFFIX = "… [truncated]";

export function truncateDebugEventMessage(message: string): string {
    if (message.length <= MAX_DEBUG_EVENT_MESSAGE_CHARS) {
        return message;
    }
    return `${message.slice(0, MAX_DEBUG_EVENT_MESSAGE_CHARS)}${TRUNCATED_DEBUG_EVENT_MESSAGE_SUFFIX}`;
}

export function sanitizeBlueprintDebugEvent(event: BlueprintDebugEvent): BlueprintDebugEvent {
    if (
        (event.type !== "devtools.log" && event.type !== "execution.error") ||
        event.message.length <= MAX_DEBUG_EVENT_MESSAGE_CHARS
    ) {
        return event;
    }
    return { ...event, message: truncateDebugEventMessage(event.message) };
}

/**
 * In-process debug event bus for Dev Mode (M3-min). No IPC to Workspace.
 */
export class DebugBridge {
    private readonly listeners = new Set<DebugEventListener>();
    private readonly eventObservers = new Set<DebugEventObserver>();
    private readonly buffer: BlueprintDebugEvent[] = [];
    private notifyScheduled = false;

    public emit(event: BlueprintDebugEvent): void {
        const sanitized = sanitizeBlueprintDebugEvent(event);
        this.buffer.push(sanitized);
        if (this.buffer.length > MAX_DEBUG_EVENT_BUFFER_LENGTH) {
            this.buffer.splice(0, this.buffer.length - MAX_DEBUG_EVENT_BUFFER_LENGTH);
        }
        this.notifyEventObservers(sanitized);
        this.scheduleNotifyListeners();
    }

    public subscribe(listener: DebugEventListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    public subscribeEvents(observer: DebugEventObserver): () => void {
        this.eventObservers.add(observer);
        return () => {
            this.eventObservers.delete(observer);
        };
    }

    public snapshot(): BlueprintDebugEvent[] {
        return [...this.buffer];
    }

    public clear(): void {
        this.buffer.length = 0;
        this.scheduleNotifyListeners();
    }

    private notifyEventObservers(event: BlueprintDebugEvent): void {
        for (const observer of this.eventObservers) {
            observer(event);
        }
    }

    private scheduleNotifyListeners(): void {
        if (this.notifyScheduled) {
            return;
        }
        this.notifyScheduled = true;
        const notify = () => {
            this.notifyScheduled = false;
            this.notifyListeners();
        };
        if (typeof globalThis.requestAnimationFrame === "function") {
            globalThis.requestAnimationFrame(notify);
        } else {
            queueMicrotask(notify);
        }
    }

    private notifyListeners(): void {
        for (const l of this.listeners) {
            l();
        }
    }
}
