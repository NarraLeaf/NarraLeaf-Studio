/**
 * Per-surface runtime key/value store for Blueprint M3-min (surface state only).
 */

export type SurfaceStateListener = () => void;

/**
 * Whether a write leaves the store saying exactly what it said before.
 *
 * Announcing one is not free: a listener's answer to "state changed" is to rebuild a surface's whole
 * element tree, and writing a value the store already holds is ordinary rather than rare - a
 * lifecycle handler seeding its defaults on every entry, a slider committing the position it is
 * already at.
 *
 * **Only primitives are compared.** An object handed back under the same key may be the same
 * reference with different contents, and nothing here can tell that apart from a write that truly
 * changed nothing - so those always announce, exactly as before. A key the store has never held also
 * always announces, so `getSnapshot` (what the Dev Mode debugger lists) gains its row when written.
 */
export function isUnchangedStateWrite(values: ReadonlyMap<string, unknown>, key: string, value: unknown): boolean {
    if (!values.has(key) || !Object.is(values.get(key), value)) {
        return false;
    }
    return value === null || (typeof value !== "object" && typeof value !== "function");
}

export class SurfaceStateStore {
    private readonly values = new Map<string, unknown>();
    private readonly listeners = new Set<SurfaceStateListener>();

    public constructor(public readonly surfaceId: string) {}

    public get(key: string): unknown {
        return this.values.get(key);
    }

    public set(key: string, value: unknown): void {
        const unchanged = isUnchangedStateWrite(this.values, key, value);
        this.values.set(key, value);
        if (unchanged) {
            return;
        }
        this.notify();
    }

    /** Immutable copy of all surface state keys (Dev Mode debugger). */
    public getSnapshot(): ReadonlyMap<string, unknown> {
        return new Map(this.values);
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
