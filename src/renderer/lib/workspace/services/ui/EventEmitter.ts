/**
 * Simple event emitter for service-to-UI communication
 */
export class EventEmitter<TEvents extends Record<string, any> = Record<string, any>> {
    private listeners: Map<keyof TEvents, Set<(data: any) => void>> = new Map();

    /**
     * Subscribe to an event
     */
    public on<K extends keyof TEvents>(event: K, handler: (data: TEvents[K]) => void): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        
        this.listeners.get(event)!.add(handler);

        // Return unsubscribe function
        return () => this.off(event, handler);
    }

    /**
     * Unsubscribe from an event
     */
    public off<K extends keyof TEvents>(event: K, handler: (data: TEvents[K]) => void): void {
        const handlers = this.listeners.get(event);
        if (handlers) {
            handlers.delete(handler);
        }
    }

    /**
     * Emit an event
     */
    public emit<K extends keyof TEvents>(event: K, data: TEvents[K]): void {
        const handlers = this.listeners.get(event);
        if (handlers) {
            handlers.forEach(handler => handler(data));
        }
    }

    /**
     * Subscribe to an event once
     */
    public once<K extends keyof TEvents>(event: K, handler: (data: TEvents[K]) => void): () => void {
        const wrappedHandler = (data: TEvents[K]) => {
            handler(data);
            this.off(event, wrappedHandler);
        };
        return this.on(event, wrappedHandler);
    }

    /**
     * Clear all listeners
     */
    public clear(): void {
        this.listeners.clear();
    }

    /**
     * Clear listeners for a specific event
     */
    public clearEvent<K extends keyof TEvents>(event: K): void {
        this.listeners.delete(event);
    }

    /**
     * Get listener count for an event
     */
    public listenerCount<K extends keyof TEvents>(event: K): number {
        return this.listeners.get(event)?.size ?? 0;
    }
}

