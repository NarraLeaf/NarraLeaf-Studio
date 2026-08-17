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

    /**
     * Write a persistent value: into the map now, into the store as soon as it will take it.
     *
     * There used to be two setters here, one word apart, and only one of them reached the store.
     * The same confusion shipped three times — story-written persistent variables that no blueprint
     * could see, a playtime total that never survived a relaunch, and a read-text record that made
     * skip-read-text skip nothing on every playthrough after the first. Each read back perfectly
     * within the session that wrote it, which is why none of them was caught by a test and two took
     * driving the real app to find.
     *
     * They are one method now, and the order below is what makes that possible. The map is updated
     * **synchronously, before anything is awaited**, so a caller whose very next line reads the
     * value still sees it; the durable write follows. That ordering is the whole reason call sites
     * used to write twice, and removing the reason is what removes the mistake.
     *
     * Returns the durable half, so a caller that must know it landed can await it. Most do not: the
     * value is already readable, and a failed disk write is not something a story can act on.
     */
    public persistenceSet(key: string, value: unknown): Promise<void> {
        this.applyPersistenceLocally(key, value);
        return this.writePersistenceThrough(key, value);
    }

    /**
     * Write a persistent value into this session only, never to the store.
     *
     * Named to be uncomfortable, because it almost never is what you want: the reason to put a
     * value in the persistence scope at all is that it should outlive the window. Reach for it only
     * when the value is re-derived on every boot from something outside the store, and say which
     * something in a comment at the call site.
     */
    public persistenceSetSessionOnly(key: string, value: unknown): void {
        this.applyPersistenceLocally(key, value);
    }

    private applyPersistenceLocally(key: string, value: unknown): void {
        if (value === undefined) {
            this.persistenceValues.delete(key);
        } else {
            this.persistenceValues.set(key, value);
        }
        this.notifyPersistence();
    }

    private async writePersistenceThrough(key: string, value: unknown): Promise<void> {
        const adapter = this.persistenceAdapter;
        if (!adapter) {
            return;
        }
        if (value === undefined && adapter.removeValue) {
            await adapter.removeValue(key);
            return;
        }
        await adapter.setValue(key, value);
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
