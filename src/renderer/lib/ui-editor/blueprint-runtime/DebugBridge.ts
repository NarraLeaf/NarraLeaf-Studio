import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";

export type DebugEventListener = (event: BlueprintDebugEvent) => void;

/**
 * In-process debug event bus for Dev Mode (M3-min). No IPC to Workspace.
 */
export class DebugBridge {
    private readonly listeners = new Set<DebugEventListener>();
    private readonly buffer: BlueprintDebugEvent[] = [];
    private readonly maxBuffer = 200;

    public emit(event: BlueprintDebugEvent): void {
        this.buffer.push(event);
        if (this.buffer.length > this.maxBuffer) {
            this.buffer.splice(0, this.buffer.length - this.maxBuffer);
        }
        for (const l of this.listeners) {
            l(event);
        }
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
}
