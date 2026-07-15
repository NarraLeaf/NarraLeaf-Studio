import type { DevModeSaveRecord } from "@shared/types/devModeSave";
import {
    buildRuntimeSaveRecord,
    normalizeRuntimeJsonValue,
    normalizeRuntimeSaveId,
    parseRuntimeSaveRecord,
} from "@shared/utils/runtimeSaveRecord";

const DB_VERSION = 1;
const SAVES_STORE = "saves";
const PERSISTENCE_STORE = "persistence";

/**
 * IndexedDB-backed saves and persistence for the web runtime shell. Mirrors
 * the desktop stores in src/runtime/main/runtimeStorage.ts through the shared
 * record helpers: records are validated with the same parser and rebuilt with
 * the same createdAt-preserving writer, so a save produced by either shell has
 * an identical shape. Unlike the file-backed stores there is no write
 * coalescing: every IndexedDB write is transactional and callers resolve when
 * the transaction commits, so nothing needs flushing before the page unloads.
 */
export class WebGameStorage {
    private dbPromise: Promise<IDBDatabase> | null = null;

    constructor(private readonly dbName: string) {}

    public async writeSave(id: string, savedGame: unknown, capture?: string, metadata?: unknown): Promise<void> {
        const normalizedId = normalizeRuntimeSaveId(id);
        const previous = await this.readSave(normalizedId);
        const record = buildRuntimeSaveRecord({
            id: normalizedId,
            savedGame,
            capture,
            metadata,
            previous,
            now: new Date().toISOString(),
        });
        await this.run(SAVES_STORE, "readwrite", store => store.put(record, normalizedId));
    }

    public async readSave(id: string): Promise<DevModeSaveRecord | null> {
        const normalizedId = normalizeRuntimeSaveId(id);
        const value = await this.run(SAVES_STORE, "readonly", store => store.get(normalizedId));
        return parseRuntimeSaveRecord(value);
    }

    public async listSaveIds(): Promise<string[]> {
        const keys = await this.run(SAVES_STORE, "readonly", store => store.getAllKeys());
        return keys.map(key => String(key));
    }

    public async readSavePreview(id: string): Promise<string | null> {
        const record = await this.readSave(id);
        return record?.metadata.capture ?? null;
    }

    public async deleteSave(id: string): Promise<{ deleted: boolean }> {
        const normalizedId = normalizeRuntimeSaveId(id);
        const existingKey = await this.run(SAVES_STORE, "readonly", store => store.getKey(normalizedId));
        await this.run(SAVES_STORE, "readwrite", store => store.delete(normalizedId));
        return { deleted: existingKey !== undefined };
    }

    public async getAllPersistence(): Promise<Record<string, unknown>> {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(PERSISTENCE_STORE, "readonly");
            const store = tx.objectStore(PERSISTENCE_STORE);
            const keysRequest = store.getAllKeys();
            const valuesRequest = store.getAll();
            tx.oncomplete = () => {
                const result: Record<string, unknown> = {};
                keysRequest.result.forEach((key, index) => {
                    result[String(key)] = valuesRequest.result[index];
                });
                resolve(result);
            };
            tx.onabort = () => reject(tx.error ?? new Error("Persistence read aborted"));
            tx.onerror = () => reject(tx.error ?? new Error("Persistence read failed"));
        });
    }

    public async getPersistenceValue(key: string): Promise<unknown> {
        return this.run(PERSISTENCE_STORE, "readonly", store => store.get(String(key)));
    }

    public async setPersistenceValue(key: string, value: unknown): Promise<void> {
        // Matches the desktop store: assigning undefined removes the key.
        if (value === undefined) {
            await this.removePersistenceValue(key);
            return;
        }
        const normalized = normalizeRuntimeJsonValue(value);
        await this.run(PERSISTENCE_STORE, "readwrite", store => store.put(normalized, String(key)));
    }

    public async removePersistenceValue(key: string): Promise<void> {
        await this.run(PERSISTENCE_STORE, "readwrite", store => store.delete(String(key)));
    }

    private openDb(): Promise<IDBDatabase> {
        this.dbPromise ??= new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(SAVES_STORE)) {
                    db.createObjectStore(SAVES_STORE);
                }
                if (!db.objectStoreNames.contains(PERSISTENCE_STORE)) {
                    db.createObjectStore(PERSISTENCE_STORE);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error("Failed to open the game save database"));
        });
        return this.dbPromise;
    }

    /**
     * Run one request in its own transaction, resolving with the request's
     * result once the transaction has committed (not merely when the request
     * succeeded), so a resolved write is actually durable.
     */
    private async run<T>(
        storeName: string,
        mode: IDBTransactionMode,
        op: (store: IDBObjectStore) => IDBRequest<T>,
    ): Promise<T> {
        const db = await this.openDb();
        return new Promise<T>((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const request = op(tx.objectStore(storeName));
            tx.oncomplete = () => resolve(request.result);
            tx.onabort = () => reject(tx.error ?? new Error("Game storage transaction aborted"));
            tx.onerror = () => reject(tx.error ?? new Error("Game storage transaction failed"));
        });
    }
}
