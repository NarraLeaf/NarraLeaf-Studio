import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import {
    DEV_MODE_SAVE_TYPE_NORMAL,
    type DevModeSaveRecord,
} from "@shared/types/devModeSave";

type SaveFileRecord = DevModeSaveRecord & {
    version: 1;
};

type PendingSaveOp =
    | { kind: "write"; record: SaveFileRecord }
    | { kind: "delete" };

const SAVE_FILE_EXTENSION = ".json";

export function normalizeRuntimeSaveId(id: string): string {
    const safe = String(id ?? "").trim();
    if (!safe) {
        throw new Error("Save id is required");
    }
    if (safe === "." || safe === ".." || /[\\/]/.test(safe) || /[\u0000-\u001f\u007f]/.test(safe)) {
        throw new Error("Save id cannot be a path segment");
    }
    return safe;
}

/**
 * Save records carry base64 captures that make each file expensive to read and
 * serialize, so the store answers reads from memory after the first disk hit
 * and coalesces bursts of writes: while a disk write is in flight (or queued
 * behind the microtask defer), newer writes for the same id replace the queued
 * one and only the last state reaches disk. Callers still resolve only after
 * the state they wrote (or a newer one) has been persisted, and `flush()`
 * drains everything before the app quits.
 */
export class RuntimeSaveStore {
    /**
     * Records by normalized id, loaded lazily on first access. A null entry
     * means "known absent" so repeat misses also skip the disk.
     */
    private readonly records = new Map<string, SaveFileRecord | null>();
    /** Latest not-yet-persisted operation per id; flushing writes only this one. */
    private readonly pendingOps = new Map<string, PendingSaveOp>();
    /** One drain loop per id with a queued operation. */
    private readonly flushers = new Map<string, Promise<void>>();
    /** Operations that have not yet reached their scheduled flush. */
    private readonly inFlightOps = new Set<Promise<void>>();

    constructor(private readonly userDataDir: string) {}

    public write(id: string, savedGame: unknown, capture?: string, metadata?: unknown): Promise<void> {
        return this.track((async () => {
            const normalizedId = normalizeRuntimeSaveId(id);
            const previous = await this.loadRecord(normalizedId);
            const now = new Date().toISOString();
            const record: SaveFileRecord = {
                version: 1,
                metadata: {
                    id: normalizedId,
                    type: DEV_MODE_SAVE_TYPE_NORMAL,
                    createdAt: previous?.metadata.createdAt ?? now,
                    updatedAt: now,
                    ...(typeof capture === "string" && capture ? { capture } : {}),
                    user: normalizeJsonValue(metadata),
                },
                savedGame: normalizeJsonValue(savedGame),
            };
            this.records.set(normalizedId, record);
            await this.schedule(normalizedId, { kind: "write", record });
        })());
    }

    public async read(id: string): Promise<DevModeSaveRecord | null> {
        const normalizedId = normalizeRuntimeSaveId(id);
        const record = await this.loadRecord(normalizedId);
        return record ? { metadata: record.metadata, savedGame: record.savedGame } : null;
    }

    public async listIds(): Promise<string[]> {
        const dir = this.saveDir();
        let names: string[];
        try {
            names = await fs.readdir(dir);
        } catch (error) {
            if (isNodeErrorCode(error, "ENOENT")) {
                names = [];
            } else {
                throw error;
            }
        }
        // Files whose id is already cached are reported from memory below; only
        // unknown files are read, which keeps repeat listings cheap.
        const cachedFileNames = new Set<string>();
        for (const id of this.records.keys()) {
            cachedFileNames.add(this.saveFileName(id));
        }
        const ids = new Set<string>();
        for (const name of names.filter(item => item.endsWith(SAVE_FILE_EXTENSION))) {
            if (cachedFileNames.has(name)) {
                continue;
            }
            try {
                const raw = await fs.readFile(path.join(dir, name), "utf-8");
                const record = parseSaveRecord(JSON.parse(raw));
                if (record) {
                    ids.add(record.metadata.id);
                }
            } catch {
                /* Ignore corrupt save files in preview runtime. */
            }
        }
        // Overlay in-memory state so records that were just written (or deleted)
        // but not yet flushed are reported correctly.
        for (const [id, record] of this.records) {
            if (record) {
                ids.add(id);
            } else {
                ids.delete(id);
            }
        }
        return [...ids];
    }

    public async readPreview(id: string): Promise<string | null> {
        const record = await this.read(id);
        return record?.metadata.capture ?? null;
    }

    public delete(id: string): Promise<{ deleted: boolean }> {
        const task = (async () => {
            const normalizedId = normalizeRuntimeSaveId(id);
            const existed = (await this.loadRecord(normalizedId)) !== null;
            this.records.set(normalizedId, null);
            await this.schedule(normalizedId, { kind: "delete" });
            return { deleted: existed };
        })();
        void this.track(task.then(() => undefined));
        return task;
    }

    /** Persist every queued operation. Called before the app quits. */
    public async flush(): Promise<void> {
        while (this.inFlightOps.size > 0 || this.flushers.size > 0) {
            await Promise.allSettled([...this.inFlightOps, ...this.flushers.values()]);
        }
    }

    public hasPendingWrites(): boolean {
        return this.inFlightOps.size > 0 || this.pendingOps.size > 0 || this.flushers.size > 0;
    }

    private track(task: Promise<void>): Promise<void> {
        this.inFlightOps.add(task);
        const untrack = () => {
            this.inFlightOps.delete(task);
        };
        task.then(untrack, untrack);
        return task;
    }

    private async loadRecord(normalizedId: string): Promise<SaveFileRecord | null> {
        if (this.records.has(normalizedId)) {
            return this.records.get(normalizedId) ?? null;
        }
        let record: SaveFileRecord | null = null;
        try {
            const raw = await fs.readFile(this.saveFilePath(normalizedId), "utf-8");
            const parsed = parseSaveRecord(JSON.parse(raw));
            record = parsed ? { version: 1, ...parsed } : null;
        } catch {
            record = null;
        }
        // A write may have populated the entry while the disk read was in
        // flight; the newer in-memory state wins over what was on disk.
        if (!this.records.has(normalizedId)) {
            this.records.set(normalizedId, record);
        }
        return this.records.get(normalizedId) ?? null;
    }

    private schedule(id: string, op: PendingSaveOp): Promise<void> {
        this.pendingOps.set(id, op);
        const existing = this.flushers.get(id);
        if (existing) {
            return existing;
        }
        const flusher = (async () => {
            // Defer one microtask so bursts of writes issued back-to-back
            // collapse into a single disk write.
            await Promise.resolve();
            let failure: unknown = null;
            for (;;) {
                const next = this.pendingOps.get(id);
                if (!next) {
                    break;
                }
                this.pendingOps.delete(id);
                try {
                    if (next.kind === "write") {
                        await atomicWriteJson(this.saveFilePath(id), next.record);
                    } else {
                        await unlinkIgnoringMissing(this.saveFilePath(id));
                    }
                } catch (error) {
                    failure = error;
                }
            }
            // Removed synchronously with the empty-queue observation above so a
            // schedule() racing this loop can never attach to a settled flusher.
            this.flushers.delete(id);
            if (failure) {
                throw failure;
            }
        })();
        this.flushers.set(id, flusher);
        return flusher;
    }

    private saveDir(): string {
        return path.join(this.userDataDir, "saves");
    }

    private saveFileName(id: string): string {
        const hash = crypto.createHash("sha256").update(id).digest("hex");
        return `${hash}${SAVE_FILE_EXTENSION}`;
    }

    private saveFilePath(id: string): string {
        return path.join(this.saveDir(), this.saveFileName(id));
    }
}

/**
 * Blueprint persistence lives in a single JSON file. The store is loaded once,
 * mutated in memory, and written back asynchronously with the same coalescing
 * scheme as saves: bursts of setValue calls produce one disk write carrying
 * the final state.
 */
export class RuntimePersistenceStore {
    private store: Record<string, unknown> | null = null;
    private loading: Promise<Record<string, unknown>> | null = null;
    private dirty = false;
    private flusher: Promise<void> | null = null;
    /** Mutations that have not yet reached their scheduled flush. */
    private readonly inFlightOps = new Set<Promise<void>>();

    constructor(private readonly userDataDir: string) {}

    public async getAll(): Promise<Record<string, unknown>> {
        return { ...(await this.loadStore()) };
    }

    public async getValue(key: string): Promise<unknown> {
        return (await this.loadStore())[key];
    }

    public setValue(key: string, value: unknown): Promise<void> {
        return this.track((async () => {
            const store = await this.loadStore();
            if (value === undefined) {
                delete store[key];
            } else {
                store[key] = normalizeJsonValue(value);
            }
            await this.scheduleFlush();
        })());
    }

    public removeValue(key: string): Promise<void> {
        return this.track((async () => {
            const store = await this.loadStore();
            delete store[key];
            await this.scheduleFlush();
        })());
    }

    /** Persist every queued mutation. Called before the app quits. */
    public async flush(): Promise<void> {
        while (this.inFlightOps.size > 0 || this.flusher) {
            await Promise.allSettled([...this.inFlightOps, ...(this.flusher ? [this.flusher] : [])]);
        }
    }

    public hasPendingWrites(): boolean {
        return this.inFlightOps.size > 0 || this.dirty || this.flusher !== null;
    }

    private track(task: Promise<void>): Promise<void> {
        this.inFlightOps.add(task);
        const untrack = () => {
            this.inFlightOps.delete(task);
        };
        task.then(untrack, untrack);
        return task;
    }

    private loadStore(): Promise<Record<string, unknown>> {
        if (this.store) {
            return Promise.resolve(this.store);
        }
        if (!this.loading) {
            this.loading = this.readStoreFromDisk().then(data => {
                this.store ??= data;
                this.loading = null;
                return this.store;
            });
        }
        return this.loading;
    }

    private scheduleFlush(): Promise<void> {
        this.dirty = true;
        if (this.flusher) {
            return this.flusher;
        }
        const flusher = (async () => {
            // Defer one microtask so bursts of mutations issued back-to-back
            // collapse into a single disk write.
            await Promise.resolve();
            let failure: unknown = null;
            while (this.dirty) {
                this.dirty = false;
                try {
                    await atomicWriteJson(this.storePath(), this.store ?? {});
                } catch (error) {
                    failure = error;
                }
            }
            // Cleared synchronously with the dirty-flag observation above so a
            // scheduleFlush() racing this loop never attaches to a settled run.
            this.flusher = null;
            if (failure) {
                throw failure;
            }
        })();
        this.flusher = flusher;
        return flusher;
    }

    private async readStoreFromDisk(): Promise<Record<string, unknown>> {
        try {
            const raw = await fs.readFile(this.storePath(), "utf-8");
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : {};
        } catch (error) {
            if (isNodeErrorCode(error, "ENOENT")) {
                return {};
            }
            throw error;
        }
    }

    private storePath(): string {
        return path.join(this.userDataDir, "persistence.json");
    }
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(value), "utf-8");
    await fs.rename(tempPath, filePath);
}

async function unlinkIgnoringMissing(filePath: string): Promise<void> {
    try {
        await fs.unlink(filePath);
    } catch (error) {
        if (!isNodeErrorCode(error, "ENOENT")) {
            throw error;
        }
    }
}

function parseSaveRecord(value: unknown): DevModeSaveRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as Partial<SaveFileRecord>;
    if (record.version !== 1 || !record.metadata || typeof record.metadata.id !== "string") {
        return null;
    }
    if (record.metadata.type !== DEV_MODE_SAVE_TYPE_NORMAL) {
        return null;
    }
    return {
        metadata: {
            id: normalizeRuntimeSaveId(record.metadata.id),
            type: DEV_MODE_SAVE_TYPE_NORMAL,
            createdAt: typeof record.metadata.createdAt === "string" ? record.metadata.createdAt : "",
            updatedAt: typeof record.metadata.updatedAt === "string" ? record.metadata.updatedAt : "",
            ...(typeof record.metadata.capture === "string" && record.metadata.capture ? { capture: record.metadata.capture } : {}),
            user: normalizeJsonValue(record.metadata.user),
        },
        savedGame: record.savedGame,
    };
}

function normalizeJsonValue(value: unknown): unknown {
    if (value === undefined) {
        return null;
    }
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? null : JSON.parse(serialized);
    } catch {
        return null;
    }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
