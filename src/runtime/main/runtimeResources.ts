import fs from "fs/promises";
import path from "path";
import {
    LAYER_DESCRIPTOR_ENTRY,
    LAYER_FILE_EXTENSION,
    openSealedBundle,
    openSealedLayer,
    RUNTIME_BUNDLE_FILENAME,
    RUNTIME_SUPPORT_FILENAME,
    type SealedBundleReader,
    type SealedLayerReader,
} from "@narraleaf/encryption/runtime";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { GAME_RUNTIME_BUNDLE_PACK_ENTRY, gameRuntimeBundleRuntimeEntry } from "@shared/utils/gameRuntimeBundle";
import { PATCH_DIRECTORY_NAME } from "@shared/utils/patchDelivery";
import { resolveRuntimeAssetPath } from "./runtimeProtocol";

// Runtime files served from the store are limited to the author-supplied code
// the pack carries - bundled plugin entries and puppet backends; the pack and
// assets have their own request hosts. Anchoring on these prefixes keeps the
// runtime host from reaching other store entries by path.
const RUNTIME_STORE_FILE_PREFIXES = ["plugins/", "puppet/"] as const;

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
 * loose files otherwise. A protected store is opened purely through the support
 * binary in the app dir - the protection layer carries no key material in JS.
 *
 * Then look for patches, and read through them when there are any. Discovery is
 * unconditional and costs a directory listing; a build with no patches beside it
 * gets the same object it always got, so nothing about the ordinary path changes.
 */
export async function createRuntimeResources(
    appDir: string,
    options: RuntimeResourcesOptions = {},
): Promise<RuntimeResources> {
    const bundlePath = path.join(appDir, RUNTIME_BUNDLE_FILENAME);
    const base: RuntimeResources = await fileExists(bundlePath)
        ? new SealedRuntimeResources(await openSealedBundle(
            path.join(appDir, RUNTIME_SUPPORT_FILENAME),
            bundlePath,
        ))
        : new LooseRuntimeResources(appDir);

    const patches = await openPatches(appDir, await readVerificationKey(base), options);
    return patches.length > 0 ? new PatchedRuntimeResources(base, patches) : base;
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
        if (!RUNTIME_STORE_FILE_PREFIXES.some(prefix => name.startsWith(prefix)) || !this.reader.has(name)) {
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

export interface RuntimeResourcesOptions {
    /**
     * The game's own folder - the one holding the executable - whose `patch/` is
     * where a player puts a patch. Omitted by callers that have none.
     */
    gameRootDir?: string;
    /**
     * The player's data directory, whose `patch/` is searched as well so a patch
     * survives reinstalling the game. Omitted by callers that have none.
     */
    userDataDir?: string;
    /** Where discovery notes go. Silent when omitted. */
    log?: (level: "info" | "warning", message: string) => void;
}

/**
 * One opened patch, in the order it applies. Later entries win.
 */
type OpenPatch = {
    /** Filename, which is what a reader of the log has in front of them. */
    label: string;
    reader: SealedLayerReader;
    /**
     * Whether the file proved it came from the project that built this game.
     *
     * This is the whole of the trust decision. A file that merely opens proves
     * nothing: the value that opens it is inside the game the player already has,
     * so anybody holding the game can produce one. What a proof buys is the
     * difference between "the author shipped this" and "somebody made this".
     */
    proven: boolean;
};

/**
 * Payload assembled from a base and the patches applied over it.
 *
 * Nothing installed is modified: the base store and the app dir are read exactly
 * as they were, and a patch is an additional file consulted first. Removing that
 * file restores the previous state with no other step, which is the property the
 * whole design is for - and the reason a patch is never unpacked over anything.
 *
 * What a patch may contribute depends on whether it proved its origin:
 *
 *  - the pack descriptor, and the runtime code the store serves (plugin entries,
 *    puppet backends), come from proven patches only. Both are executed, so an
 *    unproven file allowed to supply either would be running its own code inside
 *    the game.
 *  - asset bytes come from any patch. An asset is addressed through the effective
 *    pack's own manifest, so an unproven patch can only answer for an asset this
 *    build already has - it cannot introduce one, and it cannot reach anything
 *    that is not an asset. That is the entire unproven tier, and it falls out of
 *    how assets are addressed rather than being a rule enforced beside it.
 */
class PatchedRuntimeResources implements RuntimeResources {
    private readonly readCache = new BoundedBufferCache(STORE_READ_CACHE_MAX_BYTES);

    /** @param patches lowest priority first. */
    constructor(
        private readonly base: RuntimeResources,
        private readonly patches: OpenPatch[],
    ) {}

    /** The last patch that carries `name`, or null. */
    private resolve(name: string, provenOnly: boolean): { patch: OpenPatch; index: number } | null {
        for (let index = this.patches.length - 1; index >= 0; index--) {
            const patch = this.patches[index];
            if (provenOnly && !patch.proven) {
                continue;
            }
            if (patch.reader.has(name)) {
                return { patch, index };
            }
        }
        return null;
    }

    /**
     * Keyed by which patch answered, not by entry name alone. Two patches may
     * carry the same name, and a cache that could not tell them apart would serve
     * one file's bytes under the other's entry for the rest of the session.
     */
    private async read(found: { patch: OpenPatch; index: number }, name: string): Promise<Buffer> {
        const key = `${found.index}:${name}`;
        const cached = this.readCache.get(key);
        if (cached) {
            return cached;
        }
        const data = await found.patch.reader.read(name);
        this.readCache.set(key, data);
        return data;
    }

    async readPack(): Promise<Buffer> {
        const found = this.resolve(GAME_RUNTIME_BUNDLE_PACK_ENTRY, true);
        return found ? this.read(found, GAME_RUNTIME_BUNDLE_PACK_ENTRY) : this.base.readPack();
    }

    async readAsset(pack: GameRuntimePackV1, assetId: string): Promise<Buffer> {
        const item = pack.assets.items[assetId];
        // An unknown id is the base's answer to give: the message it throws names
        // the id, and duplicating that here would be a second wording of it.
        if (item) {
            const found = this.resolve(item.relativePath, false);
            if (found) {
                return this.read(found, item.relativePath);
            }
        }
        return this.base.readAsset(pack, assetId);
    }

    getAssetFilePath(pack: GameRuntimePackV1, assetId: string): string | null {
        const item = pack.assets.items[assetId];
        // A patched asset has no file to stream from, even on a build whose own
        // assets are loose - so the caller has to come back through readAsset.
        if (item && this.resolve(item.relativePath, false)) {
            return null;
        }
        return this.base.getAssetFilePath(pack, assetId);
    }

    async readRuntimeFile(pathname: string): Promise<Buffer | null> {
        const name = gameRuntimeBundleRuntimeEntry(pathname);
        if (RUNTIME_STORE_FILE_PREFIXES.some(prefix => name.startsWith(prefix))) {
            const found = this.resolve(name, true);
            if (found) {
                return this.read(found, name);
            }
        }
        return this.base.readRuntimeFile(pathname);
    }

    async dispose(): Promise<void> {
        this.readCache.clear();
        for (const patch of this.patches) {
            await patch.reader.close().catch(() => undefined);
        }
        await this.base.dispose();
    }
}

/**
 * What a patch says about itself: a name for logs, and where it belongs among its
 * siblings. Everything here is advisory - a patch that carries no descriptor, or
 * a malformed one, still applies. The file is already proven or not by the time
 * this is read, and refusing one over a missing label would fail a player's
 * install for a reason they cannot act on.
 */
type PatchDescriptor = {
    name?: string;
    order?: number;
};

async function readPatchDescriptor(reader: SealedLayerReader): Promise<PatchDescriptor> {
    if (!reader.has(LAYER_DESCRIPTOR_ENTRY)) {
        return {};
    }
    try {
        const parsed = JSON.parse((await reader.read(LAYER_DESCRIPTOR_ENTRY)).toString("utf-8")) as unknown;
        if (!parsed || typeof parsed !== "object") {
            return {};
        }
        const record = parsed as Record<string, unknown>;
        return {
            ...(typeof record.name === "string" ? { name: record.name } : {}),
            ...(typeof record.order === "number" && Number.isFinite(record.order) ? { order: record.order } : {}),
        };
    } catch {
        return {};
    }
}

/** The patch files in one directory, in filename order. Missing directory = none. */
async function listPatchFiles(directory: string): Promise<string[]> {
    let entries: string[];
    try {
        entries = await fs.readdir(directory);
    } catch {
        return [];
    }
    return entries
        .filter(entry => entry.endsWith(LAYER_FILE_EXTENSION))
        .sort((a, b) => a.localeCompare(b))
        .map(entry => path.join(directory, entry));
}

/**
 * Open every patch this build can see, lowest priority first.
 *
 * A patch beside the executable comes before one in the player's data directory,
 * so the one that survives a reinstall wins. Both are the player's to remove,
 * which is what makes a patch undoable at all.
 *
 * A patch that will not open is skipped with a line in the log, never fatal. The
 * usual causes are a file for another game, a file for another edition, and a
 * file whose proof does not match - and none of them is a reason a player's game
 * should refuse to start.
 */
async function openPatches(
    appDir: string,
    verificationKey: string | undefined,
    options: RuntimeResourcesOptions,
): Promise<OpenPatch[]> {
    // The game's own folder first, the player's data directory second, so a patch
    // a player keeps across reinstalls wins over one that shipped beside the
    // executable. Both are theirs to add to; neither is written by the game.
    const roots: string[] = [];
    if (options.gameRootDir) {
        roots.push(path.join(options.gameRootDir, PATCH_DIRECTORY_NAME));
    }
    if (options.userDataDir) {
        roots.push(path.join(options.userDataDir, PATCH_DIRECTORY_NAME));
    }
    const files: string[] = [];
    for (const root of roots) {
        files.push(...await listPatchFiles(root));
    }
    if (files.length === 0) {
        return [];
    }

    const binaryPath = path.join(appDir, RUNTIME_SUPPORT_FILENAME);
    if (!await fileExists(binaryPath)) {
        // The build was made without a distribution key, so it has nothing to read
        // a patch through. Worth one line: the files are sitting there and the
        // player would otherwise see no effect and no reason.
        options.log?.("warning", `${files.length} patch file(s) present, but this build cannot read patches`);
        return [];
    }

    const opened: { patch: OpenPatch; order: number; at: number }[] = [];
    for (const [at, file] of files.entries()) {
        const label = path.basename(file);
        try {
            const reader = await openSealedLayer(binaryPath, file, {
                ...(verificationKey ? { verificationKey } : {}),
            });
            const descriptor = await readPatchDescriptor(reader);
            opened.push({
                patch: { label: descriptor.name ? `${label} (${descriptor.name})` : label, reader, proven: reader.proven },
                order: descriptor.order ?? 0,
                at,
            });
        } catch (error) {
            options.log?.("warning", `patch not applied: ${label} - ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // Declared order first, discovery order to break ties - so two patches that
    // both say nothing stay in the order the directories were read, which is the
    // only order a player can influence.
    opened.sort((a, b) => (a.order - b.order) || (a.at - b.at));
    for (const entry of opened) {
        options.log?.(
            "info",
            `patch applied: ${entry.patch.label} (${entry.patch.proven ? "proven" : "unproven, assets only"})`,
        );
    }
    return opened.map(entry => entry.patch);
}

/**
 * The public value this build checks a patch's proof against, or undefined when
 * the build carries none. Read from the base pack rather than passed in: it is a
 * fact about the artifact, and the artifact is what is in front of us.
 */
async function readVerificationKey(base: RuntimeResources): Promise<string | undefined> {
    try {
        const pack = JSON.parse((await base.readPack()).toString("utf-8")) as GameRuntimePackV1;
        return pack.addOns?.verificationKey;
    } catch {
        return undefined;
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
