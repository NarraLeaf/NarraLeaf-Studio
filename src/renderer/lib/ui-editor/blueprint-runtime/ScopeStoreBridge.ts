import { SurfaceStateStore } from "./SurfaceStateStore";

type ScopeMapListener = () => void;

export type BlueprintPersistentStoreAdapter = {
    getAll(): Promise<Record<string, unknown>>;
    getValue(key: string): Promise<unknown>;
    setValue(key: string, value: unknown): Promise<void>;
    removeValue?(key: string): Promise<void>;
};

/**
 * Dev Mode runtime state bridge for surface/global values plus Studio-backed persistent values.
 */
export class ScopeStoreBridge {
    private readonly surfaceStores = new Map<string, SurfaceStateStore>();
    private readonly globalValues = new Map<string, unknown>();
    private readonly persistenceValues = new Map<string, unknown>();
    private readonly globalListeners = new Set<ScopeMapListener>();
    private readonly persistenceListeners = new Set<ScopeMapListener>();
    private persistenceAdapter: BlueprintPersistentStoreAdapter | null = null;
    private persistenceAdapterVersion = 0;

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

    public setPersistenceAdapter(adapter: BlueprintPersistentStoreAdapter | null): void {
        this.persistenceAdapter = adapter;
        this.persistenceAdapterVersion++;
        if (!adapter) {
            this.persistenceValues.clear();
            this.notifyPersistence();
            return;
        }
        void this.reloadPersistenceSnapshot().catch(() => undefined);
    }

    public async reloadPersistenceSnapshot(): Promise<void> {
        const adapter = this.persistenceAdapter;
        const version = this.persistenceAdapterVersion;
        if (!adapter) {
            return;
        }
        const values = await adapter.getAll();
        if (this.persistenceAdapter !== adapter || this.persistenceAdapterVersion !== version) {
            return;
        }
        this.persistenceValues.clear();
        for (const [key, value] of Object.entries(values)) {
            if (value !== undefined) {
                this.persistenceValues.set(key, value);
            }
        }
        this.notifyPersistence();
    }

    public async persistenceGetAsync(key: string): Promise<unknown> {
        const adapter = this.persistenceAdapter;
        if (!adapter) {
            return this.persistenceGet(key);
        }
        const value = await adapter.getValue(key);
        if (this.persistenceAdapter === adapter) {
            if (value === undefined) {
                this.persistenceValues.delete(key);
            } else {
                this.persistenceValues.set(key, value);
            }
            this.notifyPersistence();
        }
        return value;
    }

    public async persistenceSetAsync(key: string, value: unknown): Promise<void> {
        const adapter = this.persistenceAdapter;
        if (adapter) {
            if (value === undefined && adapter.removeValue) {
                await adapter.removeValue(key);
            } else {
                await adapter.setValue(key, value);
            }
        }
        if (value === undefined) {
            this.persistenceValues.delete(key);
        } else {
            this.persistenceValues.set(key, value);
        }
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
