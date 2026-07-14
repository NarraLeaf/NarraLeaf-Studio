import fs from "fs/promises";
import path from "path";
import {
    openSealedBundle,
    RUNTIME_BUNDLE_FILENAME,
    RUNTIME_SUPPORT_FILENAME,
    type SealedBundleReader,
} from "@narraleaf/encryption/runtime";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { GAME_RUNTIME_BUNDLE_PACK_ENTRY, gameRuntimeBundleRuntimeEntry } from "@shared/utils/gameRuntimeBundle";
import { resolveRuntimeAssetPath } from "./runtimeProtocol";

// Runtime files served from the store are limited to bundled plugin entries; the
// pack and assets have their own request hosts. Anchoring on this prefix keeps
// the runtime host from reaching other store entries by path.
const RUNTIME_STORE_FILE_PREFIX = "plugins/";

/**
 * Byte budget for store entry reads kept in memory. The game engine drops and
 * re-requests the same assets on every scene change, and answering each of
 * those requests with a fresh store read stalls the main-process event loop;
 * repeat reads are served from this cache instead.
 */
const STORE_READ_CACHE_MAX_BYTES = 192 * 1024 * 1024;

/**
 * Backend the runtime reads its packaged payload from. A packed app either keeps
 * items as loose files under the app dir, or consolidates them into a single
 * store next to the runtime. Both are addressed the same way here so the protocol
 * handlers do not care which one they are talking to.
 */
export interface RuntimeResources {
    /** Raw bytes of the pack descriptor. */
    readPack(): Promise<Buffer>;
    /** Raw bytes of a project asset by manifest id. Throws when the id is unknown. */
    readAsset(pack: GameRuntimePackV1, assetId: string): Promise<Buffer>;
    /**
     * Absolute path of an asset that lives as a loose file the caller can read
     * or stream from disk directly, or null when the asset bytes must go
     * through {@link readAsset}. Throws when the id is unknown.
     */
    getAssetFilePath(pack: GameRuntimePackV1, assetId: string): string | null;
    /**
     * Bytes of a runtime file that is served from the consolidated store (e.g. a
     * bundled plugin entry), or null when the request should fall back to a loose
     * file on disk. Static runtime files (renderer, styles, icons) always live
     * loose and return null here.
     */
    readRuntimeFile(pathname: string): Promise<Buffer | null>;
    /** Release any held handles. */
    dispose(): Promise<void>;
}

/**
 * Pick the backend for this packed app: the consolidated store when present,
 * loose files otherwise. `packKey` is only consulted when a store exists.
 */
export async function createRuntimeResources(appDir: string, packKey: string): Promise<RuntimeResources> {
    const bundlePath = path.join(appDir, RUNTIME_BUNDLE_FILENAME);
    if (await fileExists(bundlePath)) {
        const reader = await openSealedBundle(path.join(appDir, RUNTIME_SUPPORT_FILENAME), bundlePath, packKey);
        return new SealedRuntimeResources(reader);
    }
    return new LooseRuntimeResources(appDir);
}

/**
 * Insertion-ordered LRU keyed by entry name with a total byte budget. Cached
 * buffers are treated as immutable by every consumer; hits refresh recency so
 * hot entries survive eviction.
 */
export class BoundedBufferCache {
    private readonly entries = new Map<string, Buffer>();
    private totalBytes = 0;

    constructor(private readonly maxBytes: number) {}

    public get(name: string): Buffer | null {
        const data = this.entries.get(name);
        if (!data) {
            return null;
        }
        this.entries.delete(name);
        this.entries.set(name, data);
        return data;
    }

    public set(name: string, data: Buffer): void {
        // An oversized value would flush the whole cache for a single entry.
        if (data.byteLength > this.maxBytes) {
            return;
        }
        const existing = this.entries.get(name);
        if (existing) {
            this.entries.delete(name);
            this.totalBytes -= existing.byteLength;
        }
        this.entries.set(name, data);
        this.totalBytes += data.byteLength;
        for (const [candidate, value] of this.entries) {
            if (this.totalBytes <= this.maxBytes || candidate === name) {
                break;
            }
            this.entries.delete(candidate);
            this.totalBytes -= value.byteLength;
        }
    }

    public clear(): void {
        this.entries.clear();
        this.totalBytes = 0;
    }
}

class LooseRuntimeResources implements RuntimeResources {
    constructor(private readonly appDir: string) {}

    readPack(): Promise<Buffer> {
        return fs.readFile(path.join(this.appDir, "pack.json"));
    }

    readAsset(pack: GameRuntimePackV1, assetId: string): Promise<Buffer> {
        return fs.readFile(resolveRuntimeAssetPath(this.appDir, pack, assetId));
    }

    getAssetFilePath(pack: GameRuntimePackV1, assetId: string): string | null {
        return resolveRuntimeAssetPath(this.appDir, pack, assetId);
    }

    async readRuntimeFile(_pathname: string): Promise<Buffer | null> {
        // Loose packs serve every runtime file directly from disk.
        return null;
    }

    async dispose(): Promise<void> {
        // Nothing to release.
    }
}

class SealedRuntimeResources implements RuntimeResources {
    private readonly readCache = new BoundedBufferCache(STORE_READ_CACHE_MAX_BYTES);
    /** De-duplicates concurrent reads of the same entry while one is in flight. */
    private readonly pendingReads = new Map<string, Promise<Buffer>>();

    constructor(private readonly reader: SealedBundleReader) {}

    readPack(): Promise<Buffer> {
        return this.reader.read(GAME_RUNTIME_BUNDLE_PACK_ENTRY);
    }

    readAsset(pack: GameRuntimePackV1, assetId: string): Promise<Buffer> {
        const item = pack.assets.items[assetId];
        if (!item) {
            throw new Error(`Runtime asset not found: ${assetId}`);
        }
        // The manifest records the store entry name for each asset, so the id is
        // never turned into a path and the entry name carries no extension.
        return this.readEntry(item.relativePath);
    }

    getAssetFilePath(_pack: GameRuntimePackV1, _assetId: string): string | null {
        // Store entries are not addressable as loose files.
        return null;
    }

    async readRuntimeFile(pathname: string): Promise<Buffer | null> {
        const name = gameRuntimeBundleRuntimeEntry(pathname);
        if (!name.startsWith(RUNTIME_STORE_FILE_PREFIX) || !this.reader.has(name)) {
            return null;
        }
        return this.readEntry(name);
    }

    dispose(): Promise<void> {
        this.readCache.clear();
        this.pendingReads.clear();
        return this.reader.close();
    }

    /** Read a store entry, serving repeat reads from the in-memory cache. */
    private readEntry(name: string): Promise<Buffer> {
        const cached = this.readCache.get(name);
        if (cached) {
            return Promise.resolve(cached);
        }
        const pending = this.pendingReads.get(name);
        if (pending) {
            return pending;
        }
        const read = this.reader.read(name)
            .then(data => {
                this.readCache.set(name, data);
                return data;
            })
            .finally(() => {
                this.pendingReads.delete(name);
            });
        this.pendingReads.set(name, read);
        return read;
    }
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}
