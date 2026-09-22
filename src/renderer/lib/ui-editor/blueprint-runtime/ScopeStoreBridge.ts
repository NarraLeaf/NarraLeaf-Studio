import { isUnchangedStateWrite, SurfaceStateStore } from "./SurfaceStateStore";
import {
    announceBlueprintStateWrite,
    EVERY_PERSISTENT_STATE_KEY,
    isStateWriteNoticeable,
    persistentStateKey,
} from "./blueprintStateWrites";

type ScopeMapListener = () => void;

export type BlueprintPersistentStoreAdapter = {
    getAll(): Promise<Record<string, unknown>>;
    getValue(key: string): Promise<unknown>;
    setValue(key: string, value: unknown): Promise<void>;
    removeValue?(key: string): Promise<void>;
};

export type ScopeStoreBridgeOptions = {
    /**
     * What each declared persistent variable reads as until something stores a value for it, by
     * storage key. See {@link ScopeStoreBridge.persistenceGet}.
     */
    persistentDefaults?: Readonly<Record<string, unknown>>;
};

/**
 * Runtime state bridge for surface/global values plus the host-backed persistent values, shared by
 * Dev Mode, the story preview and the shipped runtime.
 */
export class ScopeStoreBridge {
    private readonly surfaceStores = new Map<string, SurfaceStateStore>();
    private readonly globalValues = new Map<string, unknown>();
    private readonly persistenceValues = new Map<string, unknown>();
    private readonly globalListeners = new Set<ScopeMapListener>();
    private readonly persistenceListeners = new Set<ScopeMapListener>();
    private readonly persistentDefaults: ReadonlyMap<string, unknown>;
    /** This session's copy of each object default a reader has been handed; see `persistenceGet`. */
    private readonly persistentDefaultCopies = new Map<string, unknown>();
    private persistenceAdapter: BlueprintPersistentStoreAdapter | null = null;
    private persistenceAdapterVersion = 0;

    public constructor(options: ScopeStoreBridgeOptions = {}) {
        this.persistentDefaults = new Map(
            Object.entries(options.persistentDefaults ?? {}).filter(([, value]) => value !== undefined),
        );
    }

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
        // Silent when it writes what is already there - see `isUnchangedStateWrite`. Global state has
        // the wider blast radius of the two: every surface currently mounted rebuilds its tree.
        const unchanged = isUnchangedStateWrite(this.globalValues, key, value);
        this.globalValues.set(key, value);
        if (unchanged) {
            return;
        }
        this.notifyGlobals();
    }

    /**
     * What a reader sees under a persistent key: the stored value once anything has stored one, and
     * until then the author's default for the persistent variable declared on that key.
     *
     * This is the one place that rule lives, and it lives here because every reader reaches the
     * value through this bridge - `Get Persistent` and a value binding through the host API, a
     * script's `ctx.host.persistence`, a story's conditions and interpolations and a story row's
     * `ctx.persistent` through the story's port, the stage walk, the plugin state reader. Before it
     * was here, each reader that knew about defaults applied its own, and the one that did not
     * (the host API, which turns "nothing stored" into `null` for a graph) showed a variable the
     * author had given a default as empty on every screen while the story went on to read the
     * default: one variable, two answers, depending on who asked.
     *
     * The default is never written. A default stored at boot would outlive the author changing it,
     * and "reset player data" would restore whatever the first boot wrote rather than the default.
     * So the store holds only what the game wrote, and {@link getPersistenceSnapshot} still reports
     * exactly that.
     *
     * A default that is an object reads as this session's own copy of it - one copy, handed to every
     * reader until the key is written, so it behaves exactly like a stored value: the same object on
     * every read (a reader comparing snapshots by identity sees no change that did not happen), and a
     * reader that changes it in place before writing it back changes this session's value rather
     * than the declared default under every later reset.
     */
    public persistenceGet(key: string): unknown {
        return this.persistenceValues.has(key) ? this.persistenceValues.get(key) : this.persistentDefaultOf(key);
    }

    /**
     * Whether something has stored a value under this key, as opposed to it reading as its
     * declared default. For the tools that show the difference; a game has no reason to ask.
     */
    public persistenceIsStored(key: string): boolean {
        return this.persistenceValues.has(key);
    }

    private persistentDefaultOf(key: string): unknown {
        const value = this.persistentDefaults.get(key);
        if (value === null || typeof value !== "object") {
            return value;
        }
        let copy = this.persistentDefaultCopies.get(key);
        if (copy === undefined) {
            // Defaults are authored literals, so JSON is a faithful copy where `structuredClone` is
            // missing (an older mobile WebView).
            copy = typeof structuredClone === "function"
                ? structuredClone(value)
                : JSON.parse(JSON.stringify(value)) as unknown;
            this.persistentDefaultCopies.set(key, copy);
        }
        return copy;
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
        // Compared as a reader sees them, defaults included: storing a variable's own default over
        // nothing changes nothing anyone can see, and removing a stored value brings the default
        // back, which is a change.
        const previous = this.persistenceGet(key);
        // Written or removed, this session's copy of the default is finished with: a written value
        // takes its place, and a removal brings back the default as it was declared.
        this.persistentDefaultCopies.delete(key);
        if (value === undefined) {
            this.persistenceValues.delete(key);
        } else {
            this.persistenceValues.set(key, value);
        }
        this.notifyPersistence();
        // Whoever wrote it - a blueprint, a story line, the game itself - a value binding that read
        // this key through `Get Persistent` shows it.
        if (isStateWriteNoticeable(previous, this.persistenceGet(key))) {
            announceBlueprintStateWrite(persistentStateKey(key));
        }
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
            this.persistentDefaultCopies.clear();
            this.notifyPersistence();
            announceBlueprintStateWrite(EVERY_PERSISTENT_STATE_KEY);
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
        this.persistentDefaultCopies.clear();
        for (const [key, value] of Object.entries(values)) {
            if (value !== undefined) {
                this.persistenceValues.set(key, value);
            }
        }
        this.notifyPersistence();
        announceBlueprintStateWrite(EVERY_PERSISTENT_STATE_KEY);
    }

    /** {@link persistenceGet}, asked of the store itself rather than of this session's copy. */
    public async persistenceGetAsync(key: string): Promise<unknown> {
        const value = await this.persistenceStoredAsync(key);
        return value === undefined ? this.persistentDefaultOf(key) : value;
    }

    /**
     * What the store holds under this key, asked of the store itself - `undefined` when nothing has
     * been stored, never a declared default. For the callers that must tell a written value from a
     * default: exported progress carries what the player did, not what the author declared, and a
     * default exported as a value would pin it in the game that imports it.
     */
    public async persistenceStoredAsync(key: string): Promise<unknown> {
        const adapter = this.persistenceAdapter;
        if (!adapter) {
            return this.persistenceValues.get(key);
        }
        const value = await adapter.getValue(key);
        if (this.persistenceAdapter === adapter) {
            if (value === undefined) {
                this.persistenceValues.delete(key);
            } else {
                this.persistenceValues.set(key, value);
                this.persistentDefaultCopies.delete(key);
            }
            this.notifyPersistence();
        }
        return value;
    }

    public getGlobalSnapshot(): ReadonlyMap<string, unknown> {
        return new Map(this.globalValues);
    }

    /** What the store holds - written values only, never a declared default. */
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

    /**
     * Reset all scopes (e.g. Dev Mode bundle reload). Declared persistent defaults stay declared:
     * after this, every persistent variable reads as its default again.
     */
    public clearAll(): void {
        this.surfaceStores.clear();
        this.globalValues.clear();
        this.persistenceValues.clear();
        this.persistentDefaultCopies.clear();
        this.notifyGlobals();
        this.notifyPersistence();
        announceBlueprintStateWrite(EVERY_PERSISTENT_STATE_KEY);
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
