/**
 * Per-surface runtime key/value store for Blueprint M3-min (surface state only).
 */

export type SurfaceStateListener = () => void;

export class SurfaceStateStore {
    private readonly values = new Map<string, unknown>();
    private readonly listeners = new Set<SurfaceStateListener>();

    public constructor(public readonly surfaceId: string) {}

    public get(key: string): unknown {
        return this.values.get(key);
    }

    public set(key: string, value: unknown): void {
        this.values.set(key, value);
        this.notify();
    }

    public subscribe(listener: SurfaceStateListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify(): void {
        for (const l of this.listeners) {
            l();
        }
    }
}
