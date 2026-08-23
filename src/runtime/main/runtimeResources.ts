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
import {
    GAME_RUNTIME_BUNDLE_PACK_DELTA_ENTRY,
    GAME_RUNTIME_BUNDLE_PACK_ENTRY,
    gameRuntimeBundleAssetEntry,
    gameRuntimeBundleModelEntry,
    gameRuntimeBundleRuntimeEntry,
} from "@shared/utils/gameRuntimeBundle";
import { applyPackDelta, type PackDelta } from "@shared/utils/packDelta";
import { dlcAttachesToBuild } from "@shared/types/dlc";
import { dlcDirectoryCandidates, isDlcFileName } from "@shared/utils/dlcDelivery";
import { PATCH_DIRECTORY_NAME } from "@shared/utils/patchDelivery";
import { computeStoryContentHash } from "@shared/utils/storyContentHash";
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
     * Where this backend keeps the asset's bytes, as the name a patch would have to carry to
     * override it, or null when the backend cannot say without reading.
     *
     * A patch layer resolves by entry name, so it has to ask the backend underneath rather than
     * assume one - a protected store derives the name from the id, while a loose pack looks it up.
     */
    resolveEntryName(pack: GameRuntimePackV1, assetId: string): string | null;
    /**
     * Where a model bundle's entry file sits inside it, or null when the id names no bundle.
     *
     * Per id and on demand, never as a table: a caller that cannot name a model cannot learn what
     * its entry is called. A protected pack keeps this in the payload under a key derived from the
     * id; an unprotected one keeps its manifest and reads it from there.
     */
    readModelBundleEntry(pack: GameRuntimePackV1, assetId: string): Promise<string | null>;
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
    /**
     * The DLC this build is reading, in the order they apply.
     *
     * On the backend rather than beside it because installing a DLC is the same act
     * as installing a patch - a sealed layer found in a folder - and a second source
     * of truth for "which ones are here" could disagree with the one that decides
     * what the game actually reads.
     */
    installedDlcIds(): readonly string[];
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

    const layers = await openLayers(appDir, await readPackAddOns(base), options);
    return layers.length > 0 ? new PatchedRuntimeResources(base, layers, options.log) : base;
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

    resolveEntryName(pack: GameRuntimePackV1, assetId: string): string | null {
        // A loose pack keeps its manifest - the file name carries the extension the id does not.
        return pack.assets.items[assetId]?.relativePath ?? null;
    }

    async readModelBundleEntry(pack: GameRuntimePackV1, assetId: string): Promise<string | null> {
        return pack.assets.items[assetId]?.bundleEntry ?? null;
    }

    async readRuntimeFile(_pathname: string): Promise<Buffer | null> {
        // Loose packs serve every runtime file directly from disk.
        return null;
    }

    installedDlcIds(): readonly string[] {
        // A DLC arrives as a layer, so a payload with none has none.
        return [];
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

    /**
     * Read an asset by deriving its entry name from the id, never by looking it up.
     *
     * This is the whole reason a shipped protected pack can carry an empty manifest: the compiler
     * writes every asset under `assets/{id}` and this recomputes that name, so possession of an id
     * is the only thing that reaches bytes. There is deliberately no path from "I have the store" to
     * "tell me what is in it" - a caller who cannot name an asset cannot ask for it.
     *
     * Preview packs still ship a manifest, and this ignores it on purpose: resolution taking the
     * same route in both modes is what keeps a protected build from working in preview and failing
     * once shipped.
     */
    // `async` so a rejected id comes back as a rejected promise rather than a synchronous throw:
    // the contract is a promise, and a caller that only guards the await would otherwise miss it.
    async readAsset(_pack: GameRuntimePackV1, assetId: string): Promise<Buffer> {
        const id = String(assetId ?? "").trim();
        if (!id) {
            throw new Error("Asset id is required");
        }
        return this.readEntry(gameRuntimeBundleAssetEntry(id));
    }

    getAssetFilePath(_pack: GameRuntimePackV1, _assetId: string): string | null {
        // Store entries are not addressable as loose files.
        return null;
    }

    resolveEntryName(_pack: GameRuntimePackV1, assetId: string): string | null {
        const id = String(assetId ?? "").trim();
        return id ? gameRuntimeBundleAssetEntry(id) : null;
    }

    async readModelBundleEntry(_pack: GameRuntimePackV1, assetId: string): Promise<string | null> {
        const id = String(assetId ?? "").trim();
        if (!id) {
            return null;
        }
        try {
            const raw = await this.readEntry(gameRuntimeBundleModelEntry(id));
            const entry = (JSON.parse(raw.toString("utf-8")) as { e?: unknown }).e;
            return typeof entry === "string" && entry ? entry : null;
        } catch {
            // An id that names no bundle has no such item, which is an answer rather than a fault -
            // every ordinary asset reaches here on the first request that ends in a slash.
            return null;
        }
    }

    async readRuntimeFile(pathname: string): Promise<Buffer | null> {
        const name = gameRuntimeBundleRuntimeEntry(pathname);
        if (!RUNTIME_STORE_FILE_PREFIXES.some(prefix => name.startsWith(prefix)) || !this.reader.has(name)) {
            return null;
        }
        return this.readEntry(name);
    }

    installedDlcIds(): readonly string[] {
        // See LooseRuntimeResources: a store is the base, and a DLC is never one.
        return [];
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
    /**
     * Say why a patch file was not applied, rather than only that it was not.
     *
     * Off for a shipped game. The reason comes from the layer reader, and its wording describes how
     * a patch is bound to the build it belongs to - which is a description of the protection, sitting
     * in a file the player can open. What a player needs is the name of the file that did nothing.
     *
     * On for a build made to be inspected, where the author is the reader and the reason is the
     * whole point: a patch built for another project and a patch with a byte flipped are the same
     * line without it.
     */
    explainRefusedPatches?: boolean;
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
    /**
     * The DLC this file delivers, or absent on an ordinary patch.
     *
     * What the game answers "is this DLC installed" by. It comes from inside the
     * file rather than from its name so that renaming the file cannot change the
     * answer, and it is only ever set on a file whose edition matched this build.
     */
    dlcId?: string;
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

    /** The composed pack, built once: every caller reads the same one and building it parses the lot. */
    private composedPack: Promise<Buffer> | null = null;

    /** @param patches lowest priority first. */
    constructor(
        private readonly base: RuntimeResources,
        private readonly patches: OpenPatch[],
        private readonly log?: (level: "info" | "warning", message: string) => void,
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

    readPack(): Promise<Buffer> {
        this.composedPack ??= this.composePack();
        return this.composedPack;
    }

    /**
     * The pack every proven layer has had its say in, lowest first.
     *
     * A layer states what it changes rather than what the pack is, so two patches that touch
     * different scenes both land - which is the only reason a player can install an episode and a
     * language pack together. A layer that carries a whole pack instead was made before deltas
     * existed and keeps its old meaning: it becomes the pack, and anything above it applies on top.
     */
    private async composePack(): Promise<Buffer> {
        const original = await this.base.readPack();
        let pack = parseJson(original);
        if (!pack) {
            return original;
        }
        let composed = 0;
        let restateStoryHash = false;
        for (const [index, patch] of this.patches.entries()) {
            if (!patch.proven) {
                continue;
            }
            const delta = await this.readLayerDelta(patch, index);
            if (delta) {
                const report = applyPackDelta(pack, delta);
                composed++;
                restateStoryHash ||= report.touchedStory;
                if (report.skipped.length > 0) {
                    // Not fatal and not rare: a patch made against a build the player does not have
                    // names places this one has never had. What it could apply, it applied.
                    this.log?.(
                        "warning",
                        `${patch.label}: ${report.skipped.length} change(s) name nothing in this build`,
                    );
                }
                continue;
            }
            if (!patch.reader.has(GAME_RUNTIME_BUNDLE_PACK_ENTRY)) {
                continue;
            }
            const whole = parseJson(await this.read({ patch, index }, GAME_RUNTIME_BUNDLE_PACK_ENTRY));
            if (whole) {
                pack = whole;
                composed++;
                // A whole pack carries its own fingerprint for its own content.
                restateStoryHash = false;
            }
        }
        if (composed === 0) {
            return original;
        }
        // Worth a line of its own: a patch that installs and changes nothing about the story looks
        // exactly like one that was never read, and this is the difference.
        this.log?.("info", `game content composed from ${composed} patch(es)`);
        if (restateStoryHash) {
            // The stories in hand are no longer the stories any single build shipped, and the
            // fingerprint decides which of a player's saves this game offers to load. Left alone it
            // would be the last patch's answer for content that patch never saw.
            const bundle = (pack as { bundle?: unknown }).bundle;
            if (bundle && typeof bundle === "object") {
                const library = (bundle as { storyLibrary?: { documents?: Record<string, unknown> } }).storyLibrary;
                (bundle as { storyHash?: string }).storyHash = computeStoryContentHash(library?.documents);
            }
        }
        return Buffer.from(JSON.stringify(pack), "utf-8");
    }

    /** What this layer changes about the pack, or null when it carries no delta or an unreadable one. */
    private async readLayerDelta(patch: OpenPatch, index: number): Promise<PackDelta | null> {
        if (!patch.reader.has(GAME_RUNTIME_BUNDLE_PACK_DELTA_ENTRY)) {
            return null;
        }
        const parsed = parseJson(await this.read({ patch, index }, GAME_RUNTIME_BUNDLE_PACK_DELTA_ENTRY));
        // A delta that will not parse falls back to the whole pack beside it, which is the same file
        // saying the same thing in the way every build before this one read it.
        return parsed && Array.isArray((parsed as PackDelta).ops) ? parsed as unknown as PackDelta : null;
    }

    async readAsset(pack: GameRuntimePackV1, assetId: string): Promise<Buffer> {
        // An unknown id is the base's answer to give: the message it throws names
        // the id, and duplicating that here would be a second wording of it.
        const name = this.base.resolveEntryName(pack, assetId);
        if (name) {
            const found = this.resolve(name, false);
            if (found) {
                return this.read(found, name);
            }
        }
        return this.base.readAsset(pack, assetId);
    }

    getAssetFilePath(pack: GameRuntimePackV1, assetId: string): string | null {
        const name = this.base.resolveEntryName(pack, assetId);
        // A patched asset has no file to stream from, even on a build whose own
        // assets are loose - so the caller has to come back through readAsset.
        if (name && this.resolve(name, false)) {
            return null;
        }
        return this.base.getAssetFilePath(pack, assetId);
    }

    resolveEntryName(pack: GameRuntimePackV1, assetId: string): string | null {
        return this.base.resolveEntryName(pack, assetId);
    }

    async readModelBundleEntry(pack: GameRuntimePackV1, assetId: string): Promise<string | null> {
        // A patch that moves a bundle's entry file has to be able to say so, and it says it the same
        // way it says anything else: by carrying that entry name. Only a protected base keeps this
        // in the payload, so a loose one still answers from its manifest below.
        const name = this.base.resolveEntryName(pack, `${assetId}/`);
        const found = name ? this.resolve(name, false) : null;
        if (found) {
            try {
                const raw = await this.read(found, name!);
                const entry = (JSON.parse(raw.toString("utf-8")) as { e?: unknown }).e;
                if (typeof entry === "string" && entry) {
                    return entry;
                }
            } catch {
                // Fall through to the base: a patch that carries an unreadable entry record should
                // leave the installed bundle working rather than take it down with it.
            }
        }
        return this.base.readModelBundleEntry(pack, assetId);
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

    installedDlcIds(): readonly string[] {
        // In apply order, and only the ones that got as far as being applied - a file
        // whose edition did not match this build was never opened into this list.
        return this.patches.map(patch => patch.dlcId).filter((id): id is string => Boolean(id));
    }

    async dispose(): Promise<void> {
        this.readCache.clear();
        this.composedPack = null;
        for (const patch of this.patches) {
            await patch.reader.close().catch(() => undefined);
        }
        await this.base.dispose();
    }
}

/**
 * What a layer says about itself: a name for logs, where it belongs among its
 * siblings, and - on a DLC - which DLC it is and which edition it belongs to.
 *
 * The first two are advisory. A patch that carries no descriptor, or a malformed
 * one, still applies: the file is already proven or not by the time this is read,
 * and refusing one over a missing label would fail a player's install for a reason
 * they cannot act on.
 *
 * The DLC block is the exception, because it is the only thing here with a wrong
 * answer available. A DLC built for one variant opens perfectly in another whenever
 * the two override no identity - they are sealed under the same material - and the
 * player would get content their edition was never meant to have.
 */
type LayerDescriptor = {
    name?: string;
    order?: number;
    /**
     * Present on a DLC file, absent on an ordinary patch.
     *
     * `id` is what a running game answers "is this DLC installed" by. Stated inside
     * the file rather than read off its name, because the name is the player's to
     * edit and the answer must not be.
     */
    dlc?: {
        id: string;
        /** The variant this DLC belongs to. A build that is a different one refuses it. */
        attachTo: string;
    };
};

async function readLayerDescriptor(reader: SealedLayerReader): Promise<LayerDescriptor> {
    if (!reader.has(LAYER_DESCRIPTOR_ENTRY)) {
        return {};
    }
    try {
        const parsed = JSON.parse((await reader.read(LAYER_DESCRIPTOR_ENTRY)).toString("utf-8")) as unknown;
        if (!parsed || typeof parsed !== "object") {
            return {};
        }
        const record = parsed as Record<string, unknown>;
        const dlc = record.dlc && typeof record.dlc === "object" && !Array.isArray(record.dlc)
            ? record.dlc as Record<string, unknown>
            : null;
        // Only a block that names a DLC counts as one. A half-written block would
        // otherwise become a DLC with no id, which nothing could report as installed.
        const dlcId = dlc && typeof dlc.id === "string" ? dlc.id.trim() : "";
        return {
            ...(typeof record.name === "string" ? { name: record.name } : {}),
            ...(typeof record.order === "number" && Number.isFinite(record.order) ? { order: record.order } : {}),
            ...(dlcId
                ? {
                    dlc: {
                        id: dlcId,
                        attachTo: typeof dlc?.attachTo === "string" ? dlc.attachTo.trim() : "",
                    },
                }
                : {}),
        };
    } catch {
        return {};
    }
}

/**
 * Where layers are found, and what a file from each place is.
 *
 * Two places rather than one because they are two things to a player: a `patch`
 * folder holds fixes the author published, and a `DLC` folder holds content the
 * player acquired. The game reads both through the same code - a DLC file is a
 * sealed layer exactly like a patch - so the only differences are the ones below.
 */
type LayerKind = {
    /**
     * Sorts before the other kind whatever each file says about its own order.
     *
     * DLC ranks under patches because a patch fixes the game a player is running,
     * and that game includes whatever DLC they have. A patch that had to sort under
     * the DLC could not correct anything a DLC touched.
     */
    rank: number;
    /** Directory names probed under each root, preferred spelling first. */
    directories: string[];
    matches: (fileName: string) => boolean;
    /** What a file from here is called in the log. */
    noun: string;
};

function layerKinds(): LayerKind[] {
    return [
        {
            rank: 0,
            directories: dlcDirectoryCandidates(process.platform),
            matches: isDlcFileName,
            noun: "DLC",
        },
        {
            rank: 1,
            directories: [PATCH_DIRECTORY_NAME],
            matches: name => name.endsWith(LAYER_FILE_EXTENSION),
            noun: "patch",
        },
    ];
}

/** The layer files in one directory, in filename order. Missing directory = none. */
async function listLayerFiles(
    directory: string,
    matches: (fileName: string) => boolean,
): Promise<string[]> {
    let entries: string[];
    try {
        entries = await fs.readdir(directory);
    } catch {
        return [];
    }
    return entries
        .filter(matches)
        .sort((a, b) => a.localeCompare(b))
        .map(entry => path.join(directory, entry));
}

/**
 * Open every layer this build can see, lowest priority first.
 *
 * A file beside the executable comes before one in the player's data directory, so
 * the one that survives a reinstall wins. Both are the player's to remove, which is
 * what makes a patch undoable and a DLC uninstallable at all.
 *
 * A file that will not open is skipped with a line in the log, never fatal. The
 * usual causes are a file for another game, a file for another edition, and a file
 * whose proof does not match - and none of them is a reason a player's game should
 * refuse to start.
 */
async function openLayers(
    appDir: string,
    build: PackAddOns,
    options: RuntimeResourcesOptions,
): Promise<OpenPatch[]> {
    // The game's own folder first, the player's data directory second, so a file a
    // player keeps across reinstalls wins over one that shipped beside the
    // executable. Both are theirs to add to; neither is written by the game.
    const roots: string[] = [];
    if (options.gameRootDir) {
        roots.push(options.gameRootDir);
    }
    if (options.userDataDir) {
        roots.push(options.userDataDir);
    }

    const found: { file: string; kind: LayerKind }[] = [];
    // Windows resolves `DLC` and `dlc` to one directory, so probing both spellings
    // there finds every file twice. The same layer would then be applied twice, and
    // the second application would look like a change nobody shipped.
    const seen = new Set<string>();
    for (const kind of layerKinds()) {
        for (const root of roots) {
            for (const directory of kind.directories) {
                for (const file of await listLayerFiles(path.join(root, directory), kind.matches)) {
                    const key = file.toLowerCase();
                    if (seen.has(key)) {
                        continue;
                    }
                    seen.add(key);
                    found.push({ file, kind });
                }
            }
        }
    }
    if (found.length === 0) {
        return [];
    }

    const binaryPath = path.join(appDir, RUNTIME_SUPPORT_FILENAME);
    if (!await fileExists(binaryPath)) {
        // The build was made without a distribution key, so it has nothing to read a
        // layer through. Worth one line: the files are sitting there and the player
        // would otherwise see no effect and no reason.
        options.log?.("warning", `${found.length} patch or DLC file(s) present; this build applies neither`);
        return [];
    }

    const opened: { patch: OpenPatch; rank: number; order: number; at: number }[] = [];
    for (const [at, entry] of found.entries()) {
        const label = path.basename(entry.file);
        try {
            const reader = await openSealedLayer(binaryPath, entry.file, {
                ...(build.verificationKey ? { verificationKey: build.verificationKey } : {}),
            });
            const descriptor = await readLayerDescriptor(reader);
            if (descriptor.dlc && !dlcAttachesToBuild(descriptor.dlc.attachTo, build.appTagId)) {
                // Identity alone cannot catch this: two variants that override no
                // identifier are sealed under the same material, so the file opened.
                options.log?.(
                    "warning",
                    `${entry.kind.noun} not applied: ${label} - it belongs to a different edition of this game`,
                );
                await reader.close().catch(() => undefined);
                continue;
            }
            opened.push({
                patch: {
                    label: descriptor.name ? `${label} (${descriptor.name})` : label,
                    reader,
                    proven: reader.proven,
                    ...(descriptor.dlc ? { dlcId: descriptor.dlc.id } : {}),
                },
                rank: entry.kind.rank,
                order: descriptor.order ?? 0,
                at,
            });
        } catch (error) {
            // The reason is the reader's own wording about how a layer is bound to its build, so a
            // shipped game states the file and stops there.
            const reason = options.explainRefusedPatches
                ? ` - ${error instanceof Error ? error.message : String(error)}`
                : "";
            options.log?.("warning", `${entry.kind.noun} not applied: ${label}${reason}`);
        }
    }

    // Kind first, then declared order, then discovery order to break ties - so two
    // files that both say nothing stay in the order the directories were read, which
    // is the only order a player can influence.
    opened.sort((a, b) => (a.rank - b.rank) || (a.order - b.order) || (a.at - b.at));
    for (const entry of opened) {
        // What the patch does, not what let it do it. "files only" is the effect an author and a
        // player can both act on; how a layer earns more than that is not a fact a game log states.
        options.log?.(
            "info",
            `${entry.patch.dlcId ? "DLC" : "patch"} applied: ${entry.patch.label}`
            + `${entry.patch.proven ? "" : " (files only)"}`,
        );
    }
    return opened.map(entry => entry.patch);
}

/** What the base pack says about the add-ons it accepts. */
type PackAddOns = {
    /**
     * The public value this build checks a layer's proof against, or undefined when
     * the build carries none.
     */
    verificationKey?: string;
    /** The variant this build was compiled as, or undefined on packs made before builds said. */
    appTagId?: string;
};

/**
 * What this build accepts, read from the base pack rather than passed in: it is a
 * fact about the artifact, and the artifact is what is in front of us.
 */
async function readPackAddOns(base: RuntimeResources): Promise<PackAddOns> {
    try {
        const pack = JSON.parse((await base.readPack()).toString("utf-8")) as GameRuntimePackV1;
        return {
            ...(pack.addOns?.verificationKey ? { verificationKey: pack.addOns.verificationKey } : {}),
            ...(pack.addOns?.appTagId ? { appTagId: pack.addOns.appTagId } : {}),
        };
    } catch {
        return {};
    }
}

/** Parse JSON that came out of a file, as an object or not at all. */
function parseJson(data: Buffer): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(data.toString("utf-8")) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
        return null;
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
