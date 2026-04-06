import { SurfaceStateStore } from "./SurfaceStateStore";

/**
 * Dev Mode M3-full: surface / global / persistence facades (persistence is in-memory until player integration).
 */
export class ScopeStoreBridge {
    private readonly surfaceStores = new Map<string, SurfaceStateStore>();
    private readonly globalValues = new Map<string, unknown>();
    private readonly persistenceValues = new Map<string, unknown>();

    public getSurfaceStore(surfaceId: string): SurfaceStateStore {
        let store = this.surfaceStores.get(surfaceId);
        if (!store) {
            store = new SurfaceStateStore(surfaceId);
            this.surfaceStores.set(surfaceId, store);
        }
        return store;
    }

    public globalGet(key: string): unknown {
        return this.globalValues.get(key);
    }

    public globalSet(key: string, value: unknown): void {
        this.globalValues.set(key, value);
    }

    public persistenceGet(key: string): unknown {
        return this.persistenceValues.get(key);
    }

    public persistenceSet(key: string, value: unknown): void {
        this.persistenceValues.set(key, value);
    }

    /** Reset all scopes (e.g. Dev Mode bundle reload). */
    public clearAll(): void {
        this.surfaceStores.clear();
        this.globalValues.clear();
        this.persistenceValues.clear();
    }
}
