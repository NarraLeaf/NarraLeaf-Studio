import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { devModeSaveHeaderOf, type DevModeSaveHeader, type DevModeSaveRecord } from "@shared/types/devModeSave";
import type { SaveCompatibilityStamp } from "@shared/types/saveCompatibility";
import {
    buildRuntimeSaveRecord,
    normalizeRuntimeJsonValue,
    normalizeRuntimeSaveId,
    parseRuntimeSaveRecord,
    type RuntimeSaveFileRecord,
} from "@shared/utils/runtimeSaveRecord";

export { normalizeRuntimeSaveId };

type SaveFileRecord = RuntimeSaveFileRecord;

type PendingSaveOp =
    | { kind: "write"; record: SaveFileRecord }
    | { kind: "delete" };

const SAVE_FILE_EXTENSION = ".json";

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

    public write(
        id: string,
        savedGame: unknown,
        capture?: string,
        metadata?: unknown,
        compatibility?: SaveCompatibilityStamp,
        playtimeSeconds?: number,
    ): Promise<void> {
        return this.track((async () => {
            const normalizedId = normalizeRuntimeSaveId(id);
            const previous = await this.loadRecord(normalizedId);
            const record = buildRuntimeSaveRecord({
                id: normalizedId,
                savedGame,
                capture,
                metadata,
                compatibility,
                playtimeSeconds,
                previous,
                now: new Date().toISOString(),
            });
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
                const record = parseRuntimeSaveRecord(JSON.parse(raw));
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

    /**
     * Every slot's header. Built on {@link listIds} rather than beside it: the records it walks are
     * already in memory afterwards, so this costs one map over what that call loaded.
     */
    public async listHeaders(): Promise<DevModeSaveHeader[]> {
        const ids = await this.listIds();
        const headers: DevModeSaveHeader[] = [];
        for (const id of ids) {
            const record = await this.loadRecord(id);
            if (record) {
                headers.push(devModeSaveHeaderOf(record));
            }
        }
        return headers;
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
            const parsed = parseRuntimeSaveRecord(JSON.parse(raw));
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
                store[key] = normalizeRuntimeJsonValue(value);
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

/**
 * Delete temp files abandoned by a process that did not live long enough to rename one.
 *
 * {@link atomicWriteJson} writes a sibling and renames it, so a write interrupted between those two
 * steps leaves the sibling behind for good - nothing ever looks at it again, and nothing removes it.
 * It used to take a crash to produce one. It no longer does: a language change now writes and then
 * ends the process on purpose (see the renderer's `localeRestart`), and a late write from the
 * window that is going away is caught mid-rename, so a player who changes language twice has two.
 *
 * Age is the test, and it has to be, because a second copy of the same game may be running right
 * now and writing one of these. Its own temp file is milliseconds old; anything older than
 * {@link ABANDONED_TEMP_FILE_AGE_MS} belongs to a process that is not coming back. Failures are
 * swallowed by design - this is housekeeping, and a game that would not start because it could not
 * tidy up would be a worse outcome than the litter.
 */
export const ABANDONED_TEMP_FILE_AGE_MS = 5 * 60_000;

export async function sweepAbandonedTempFiles(
    directory: string,
    now: number = Date.now(),
): Promise<string[]> {
    let entries: string[];
    try {
        entries = await fs.readdir(directory);
    } catch {
        return [];
    }
    const removed: string[] = [];
    await Promise.all(entries.filter(name => name.endsWith(".tmp")).map(async name => {
        const full = path.join(directory, name);
        try {
            const stats = await fs.stat(full);
            if (now - stats.mtimeMs < ABANDONED_TEMP_FILE_AGE_MS) {
                return;
            }
            await fs.unlink(full);
            removed.push(name);
        } catch {
            // Gone already, or held by something with an opinion about it. Either way, not ours.
        }
    }));
    return removed;
}

/**
 * Write JSON where a half-written file would be worse than an old one.
 *
 * `rename` is a parameter because the refusal below is what the fallback exists for and no
 * temp directory reproduces it: it comes from whatever else on the player's machine has an
 * opinion about the destination.
 */
export async function atomicWriteJson(
    filePath: string,
    value: unknown,
    rename: (from: string, to: string) => Promise<void> = fs.rename,
): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const contents = JSON.stringify(value);
    await fs.writeFile(tempPath, contents, "utf-8");
    try {
        await rename(tempPath, filePath);
    } catch (error) {
        // Renaming one sibling onto another is atomic on every filesystem a game ships to, and a
        // player's machine can still refuse it: a sync client or a scanner holding the destination
        // answers EPERM, and a redirected profile answers EXDEV for two paths that look like
        // siblings. Writing the file directly gives up atomicity for that one write. Letting the
        // error through gives up the player's persistent variables, unlocked content and
        // preferences for every write after it, and the failure surfaces as an unhandled rejection
        // rather than as anything they can act on.
        if (!isNodeErrorCode(error, "EXDEV")
            && !isNodeErrorCode(error, "EPERM")
            && !isNodeErrorCode(error, "EACCES")) {
            throw error;
        }
        await fs.writeFile(filePath, contents, "utf-8");
        await unlinkIgnoringMissing(tempPath);
    }
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



function isNodeErrorCode(error: unknown, code: string): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
