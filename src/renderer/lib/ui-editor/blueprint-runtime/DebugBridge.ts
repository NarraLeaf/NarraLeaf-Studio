import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";

export type DebugEventListener = () => void;

export const MAX_DEBUG_EVENT_MESSAGE_CHARS = 4096;
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
    private readonly buffer: BlueprintDebugEvent[] = [];
    private readonly maxBuffer = 200;

    public emit(event: BlueprintDebugEvent): void {
        this.buffer.push(sanitizeBlueprintDebugEvent(event));
        if (this.buffer.length > this.maxBuffer) {
            this.buffer.splice(0, this.buffer.length - this.maxBuffer);
        }
        this.notifyListeners();
    }

    public subscribe(listener: DebugEventListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    public snapshot(): BlueprintDebugEvent[] {
        return [...this.buffer];
    }

    public clear(): void {
        this.buffer.length = 0;
        this.notifyListeners();
    }

    private notifyListeners(): void {
        for (const l of this.listeners) {
            l();
        }
    }
}
