import { SurfaceStateStore } from "./SurfaceStateStore";

type ScopeMapListener = () => void;

/**
 * Dev Mode M3-full: surface / global / persistence facades (persistence is in-memory until player integration).
 */
export class ScopeStoreBridge {
    private readonly surfaceStores = new Map<string, SurfaceStateStore>();
    private readonly globalValues = new Map<string, unknown>();
    private readonly persistenceValues = new Map<string, unknown>();
    private readonly globalListeners = new Set<ScopeMapListener>();
    private readonly persistenceListeners = new Set<ScopeMapListener>();

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
        this.notifyGlobals();
    }

    public persistenceGet(key: string): unknown {
        return this.persistenceValues.get(key);
    }

    public persistenceSet(key: string, value: unknown): void {
        this.persistenceValues.set(key, value);
        this.notifyPersistence();
    }

    public getGlobalSnapshot(): ReadonlyMap<string, unknown> {
        return new Map(this.globalValues);
    }

    public getPersistenceSnapshot(): ReadonlyMap<string, unknown> {
        return new Map(this.persistenceValues);
    }

    public subscribeGlobals(listener: ScopeMapListener): () => void {
        this.globalListeners.add(listener);
        return () => {
            this.globalListeners.delete(listener);
        };
    }

    public subscribePersistence(listener: ScopeMapListener): () => void {
        this.persistenceListeners.add(listener);
        return () => {
            this.persistenceListeners.delete(listener);
        };
    }

    /** Reset all scopes (e.g. Dev Mode bundle reload). */
    public clearAll(): void {
        this.surfaceStores.clear();
        this.globalValues.clear();
        this.persistenceValues.clear();
        this.notifyGlobals();
        this.notifyPersistence();
    }

    private notifyGlobals(): void {
        for (const l of this.globalListeners) {
            l();
        }
    }

    private notifyPersistence(): void {
        for (const l of this.persistenceListeners) {
            l();
        }
    }
}
