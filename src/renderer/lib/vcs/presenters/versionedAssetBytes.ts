import {
    normalizeProjectAssetSets,
    resolveAssetSetMember,
    type AssetSet,
    type AssetSetCandidate,
} from "@shared/types/assetSet";
import { isValidAssetStorageId } from "@shared/utils/assetStorageId";
import { characterAvatarBakePath, parseCharacterAvatarAssetId } from "@shared/utils/characterAvatar";
import type {
    AssetBytesPool,
    AssetBytesResult,
    AssetBytesSource,
} from "@/lib/ui-editor/assets/assetBytesSource";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { bitmapMediaType } from "./bitmapPreview";

/**
 * Every picture on a historical page, read from the version that page came from.
 *
 * This is the first implementation of {@link AssetBytesSource}, and it exists because the two mask
 * canvases were drawing the past with the present's files inside it: a background the author
 * replaced last week appeared in BOTH columns of a comparison, identical, with nothing on screen
 * saying the older one was a substitution. That is not a broken image an author can spot - it is a
 * confident wrong answer, and it is the failure this whole surface is judged on.
 *
 * ## An id becomes a path by arithmetic, and that is the whole trick
 *
 * Asset bytes are stored at `assets/content/<2>/<2>/<rest>`, derived from the id alone
 * (`ProjectNameConvention.AssetsDataShard`). Nothing is looked up to work that out, so the path is
 * as available at a version a year old as it is today, and `assets/content` is versioned - the
 * exclusion list in `@shared/vcs/workingSet` drops caches and build output and nothing else. So one
 * read at that revision is the honest answer, and there is no index to have gone stale.
 *
 * ## Two questions do need a document read, and both are asked lazily
 *
 * **Which file a SET means.** The live ladder asks `AssetSetService` and the live locale; that
 * answers with today's tags, which is exactly the wrong question here - a file retagged since is a
 * different member. So a set is resolved against that version's `editor/asset-sets.json` and the
 * tags in that version's metadata shards, fed to the same pure resolver in `@shared/types/assetSet`
 * the editor and the build use.
 *
 * **Whether the asset existed at all.** A read throws for a path a revision does not hold, and a
 * throw cannot tell "this asset was imported after that version" from "the repository could not be
 * read". The metadata shard is what tells them apart: no record means genuinely absent, a record
 * with an unreadable file means a fault. The two go to the surface as different words, which is the
 * only reason the distinction is worth the read.
 *
 * The editor's preview language is taken LIVE and deliberately. It is a property of the person
 * looking, not of the version being looked at, and reading it out of the past would change which
 * variant the author sees when they step between two versions that both hold every variant.
 *
 * ## A budget, because the repository read has no ceiling
 *
 * `VersionControlService.readWorkingFile` refuses a file past the main process's 16 MiB ceiling;
 * `readBlob` has no ceiling at all. Two columns of a busy page would otherwise pull arbitrary bytes
 * across IPC and hold them, so the ceiling is applied here instead - see
 * {@link VERSIONED_ASSET_LIMITS}.
 */

/** How much of a version's library one column may pull and hold. */
/** Separates the two halves of a cache key. Not a NUL - see the note at its use site. */
const KEY_SEPARATOR = "\u0001";

export interface VersionedAssetLimits {
    /**
     * The largest single file that will be drawn.
     *
     * 16 MiB, which is the ceiling the working-tree read already applies in the main process. The
     * two sides of a comparison must refuse the same files or the same asset would be drawn on one
     * side and refused on the other, which reads as a change that did not happen.
     */
    readonly maxBytesPerAsset: number;
    /**
     * How many bytes this column's cache holds before the oldest reads are dropped.
     *
     * 32 MiB per column, so a pair costs 64 MiB at worst, in a window that is also running the
     * author's project. Dropping an entry only forgets it: a blob already on screen belongs to the
     * hook that minted its object URL and is revoked by that hook, not by this cache.
     */
    readonly maxRetainedBytes: number;
    /**
     * How many reads are in flight at once.
     *
     * Four. A page can reference dozens of files and every one of them is a round trip on the
     * channel that also carries the editor the author is still using; issuing them all at once
     * makes the rest of Studio wait behind a comparison pane, and issuing one at a time draws a
     * busy page a file at a time. Four overlaps the latency without owning the channel.
     */
    readonly maxConcurrentReads: number;
}

export const VERSIONED_ASSET_LIMITS: VersionedAssetLimits = Object.freeze({
    maxBytesPerAsset: 16 * 1024 * 1024,
    maxRetainedBytes: 32 * 1024 * 1024,
    maxConcurrentReads: 4,
});

/** Why one asset could not be drawn from this version. The two read differently on screen. */
export type VersionedAssetRefusal = "absent" | "failed";

export interface VersionedAssetBytesSourceOptions {
    /**
     * What this source resolves against, as a stable string.
     *
     * Handed to the hook as {@link AssetBytesSource.id}, which keys every fetch on the surface - so
     * it must change when the version does and must NOT change when the provider re-renders.
     */
    readonly id: string;
    /**
     * One repository-relative path at this version, or `null` for a file past the read's own
     * ceiling. Throwing is how "this version does not hold that path" arrives.
     */
    readonly read: (path: string) => Promise<Uint8Array | null>;
    /** The language the editor previews in, for a set's axis. Live; see the module note. */
    readonly previewLocale?: string | null;
    /** Called once per asset id that could not be drawn, the first time it is asked for. */
    readonly onRefusal?: (assetId: string, kind: VersionedAssetRefusal) => void;
    readonly limits?: Partial<VersionedAssetLimits>;
}

export interface VersionedAssetBytesSource extends AssetBytesSource {
    /**
     * Drop everything held and stop answering.
     *
     * Called when the provider unmounts. A read already in flight still settles - there is no way
     * to recall a call already made - but it reports no refusal and is not cached, so nothing
     * outlives the pane that asked for it.
     */
    dispose(): void;
    /** Bytes currently held in the cache. For the budget's tests. */
    readonly retainedBytes: number;
}

/** Every pool an id can be looked up in, in the order a miss falls through them. */
const ASSET_TYPES: readonly string[] = Object.values(AssetType);

const ASSET_SETS_PATH = ProjectNameConvention.EditorAssetSets.join("/");

function shardPath(type: string): string {
    return ProjectNameConvention.AssetsMetadataShard(type as AssetType).join("/");
}

function contentPath(assetId: string): string {
    return ProjectNameConvention.AssetsDataShard(assetId).join("/");
}

function messageOf(thrown: unknown): string {
    return thrown instanceof Error ? thrown.message : String(thrown);
}

/** One cache row: the answer, and how much of the budget it is spending. */
interface CacheEntry {
    result: Promise<AssetBytesResult>;
    /** Zero while the read is in flight, and for every answer that is not bytes. */
    bytes: number;
}

export function createVersionedAssetBytesSource(
    options: VersionedAssetBytesSourceOptions,
): VersionedAssetBytesSource {
    const limits: VersionedAssetLimits = { ...VERSIONED_ASSET_LIMITS, ...options.limits };
    let disposed = false;

    /* ------------------------------------------------------------------ */
    /* The concurrency cap                                                 */
    /* ------------------------------------------------------------------ */

    let active = 0;
    const waiting: (() => void)[] = [];

    /**
     * Run one read, once a slot is free.
     *
     * Never nested: the leaf reads take a slot and nothing that holds one takes another, so there
     * is no arrangement of set resolution, shard lookup and content read that can wait on itself.
     */
    async function withSlot<T>(work: () => Promise<T>): Promise<T> {
        if (active >= limits.maxConcurrentReads) {
            await new Promise<void>(resolve => waiting.push(resolve));
        }
        active += 1;
        try {
            return await work();
        } finally {
            active -= 1;
            waiting.shift()?.();
        }
    }

    /* ------------------------------------------------------------------ */
    /* The two documents a resolution needs                                */
    /* ------------------------------------------------------------------ */

    let setsAtVersion: Promise<readonly AssetSet[]> | null = null;

    /**
     * This version's asset sets, or none.
     *
     * A missing file is not a fault: a project that declares no sets has never written one, and
     * every project older than the feature has none either. Both arrive here as a throw from the
     * read, and both mean the same thing - there are no sets to resolve against.
     */
    function loadSets(): Promise<readonly AssetSet[]> {
        setsAtVersion ??= (async () => {
            try {
                const bytes = await withSlot(() => options.read(ASSET_SETS_PATH));
                if (bytes === null) {
                    return [];
                }
                return normalizeProjectAssetSets(JSON.parse(decodeUtf8(bytes))).sets;
            } catch {
                return [];
            }
        })();
        return setsAtVersion;
    }

    const shardsAtVersion = new Map<string, Promise<ReadonlyMap<string, AssetSetCandidate>>>();

    /**
     * The tag side of one metadata shard at this version, keyed by asset id.
     *
     * Only the id, the type and the tags are kept. Everything else in a record - the name, the
     * digest, the folder - is the change list's business, and holding a whole shard per column of
     * a project with three hundred assets is a cost with nothing on the other side of it.
     */
    function loadShard(type: string): Promise<ReadonlyMap<string, AssetSetCandidate>> {
        let held = shardsAtVersion.get(type);
        if (!held) {
            held = (async () => {
                const records = new Map<string, AssetSetCandidate>();
                try {
                    const bytes = await withSlot(() => options.read(shardPath(type)));
                    if (bytes === null) {
                        return records;
                    }
                    const raw: unknown = JSON.parse(decodeUtf8(bytes));
                    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
                        return records;
                    }
                    for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
                        if (typeof entry !== "object" || entry === null) {
                            continue;
                        }
                        const tags = (entry as { tags?: unknown }).tags;
                        records.set(id, {
                            id,
                            // The shard's own file name, exactly as the document spec reads it: an
                            // entry's `type` field is authored data, and a half-written record has
                            // been seen to disagree with the file it is in.
                            type,
                            tags: Array.isArray(tags)
                                ? tags.filter((tag): tag is string => typeof tag === "string")
                                : [],
                        });
                    }
                } catch {
                    // A version with no shard of this type. Nothing of this type existed then.
                }
                return records;
            })();
            shardsAtVersion.set(type, held);
        }
        return held;
    }

    /**
     * The record for one id, or null when this version has none.
     *
     * The caller's pool is tried first and is right nearly every time; the fall-through exists
     * because a widget can name an id in the wrong pool, and the honest answer to that is still
     * whichever shard actually holds it rather than "absent".
     */
    async function recordOf(assetId: string, pool: AssetBytesPool): Promise<AssetSetCandidate | null> {
        const order = ASSET_TYPES.includes(pool)
            ? [pool, ...ASSET_TYPES.filter(type => type !== pool)]
            : ASSET_TYPES;
        for (const type of order) {
            const found = (await loadShard(type)).get(assetId);
            if (found) {
                return found;
            }
        }
        return null;
    }

    /* ------------------------------------------------------------------ */
    /* Resolution                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * Which file a set means at this version, resolved the way the editor resolves it live.
     *
     * The same preference order as `resolveEditorAssetSetMember`: the language being previewed,
     * then the axis's declared fallback, then whatever else it lists. What differs is where the
     * tags come from, which is the entire point.
     */
    async function memberOfSet(set: AssetSet): Promise<string | null> {
        if (!set.axis?.key) {
            return null;
        }
        const candidates = [...(await loadShard(set.type)).values()];
        const chain = [options.previewLocale, set.axis.fallback, ...set.axis.values]
            .filter((value): value is string => Boolean(value));
        for (const value of chain) {
            const member = resolveAssetSetMember(set, { [set.axis.key]: value }, candidates);
            if (member) {
                return member;
            }
        }
        return null;
    }

    async function readPath(path: string, fallbackType: string | null): Promise<AssetBytesResult> {
        let bytes: Uint8Array | null;
        try {
            bytes = await withSlot(() => options.read(path));
        } catch (thrown) {
            return { kind: "failed", reason: messageOf(thrown) };
        }
        if (bytes === null) {
            return { kind: "failed", reason: `File is past the read ceiling: ${path}` };
        }
        if (bytes.length > limits.maxBytesPerAsset) {
            return {
                kind: "failed",
                reason: `File is ${bytes.length} bytes, past this comparison's ceiling of ${limits.maxBytesPerAsset}`,
            };
        }
        return { kind: "bytes", bytes, mediaType: versionedMediaType(bytes) ?? fallbackType };
    }

    async function resolve(assetId: string, pool: AssetBytesPool): Promise<AssetBytesResult> {
        // A baked character avatar is a project file rather than a library asset, and it is
        // versioned like any other file under `resources/`. It is answered here for the reason the
        // hook's own note gives: the arm that would otherwise answer holds URLs the RUNNING compile
        // minted, so a dialogue avatar would be the one thing on a historical page drawn live.
        const avatar = parseCharacterAvatarAssetId(assetId);
        if (avatar) {
            return readPath(characterAvatarBakePath(avatar.characterId, avatar.key), "image/png");
        }

        const set = (await loadSets()).find(candidate => candidate.id === assetId);
        // A set with nothing behind it at this version is absent, not failed: the files it indexes
        // were imported or tagged later, which is a fact about the version.
        const fileId = set ? await memberOfSet(set) : assetId;
        if (fileId === null) {
            return { kind: "absent" };
        }
        // An id that is not a storage id names nothing this version stores. Every real one is a
        // UUID or a legacy digest, so this is also the gate that keeps a crafted id from being
        // turned into a path.
        if (!isValidAssetStorageId(fileId)) {
            return { kind: "absent" };
        }
        if (!(await recordOf(fileId, pool))) {
            return { kind: "absent" };
        }
        return readPath(contentPath(fileId), null);
    }

    /* ------------------------------------------------------------------ */
    /* The cache                                                           */
    /* ------------------------------------------------------------------ */

    const cache = new Map<string, CacheEntry>();
    let retained = 0;

    /** Drop the oldest settled rows until the budget is met. Never the row just added. */
    function evict(keep: string): void {
        for (const [key, entry] of cache) {
            if (retained <= limits.maxRetainedBytes) {
                return;
            }
            // An in-flight row holds nothing yet, so dropping it would free no bytes and would
            // start the same read again for the next caller.
            if (key === keep || entry.bytes === 0) {
                continue;
            }
            retained -= entry.bytes;
            cache.delete(key);
        }
    }

    function read(assetId: string, pool: AssetBytesPool): Promise<AssetBytesResult> {
        if (disposed) {
            return Promise.resolve({ kind: "failed", reason: "This comparison is no longer on screen" });
        }
        // Keyed on the pool as well as the id: the same id in two pools is two lookups with two
        // answers, and one of them is usually "absent". One row per key is also the in-flight
        // de-duplication - twelve widgets sharing a background are one read.
        // The separator is \u0001 rather than a NUL: a raw NUL in a source file makes git treat the
        // whole file as binary, and `git diff` then reports one line of "Binary file matches"
        // instead of the change - which has cost this repository a permanently unreviewable file
        // before. Neither an asset pool nor an id can contain either character.
        const key = `${pool}${KEY_SEPARATOR}${assetId}`;
        const held = cache.get(key);
        if (held) {
            return held.result;
        }

        const entry: CacheEntry = { result: Promise.resolve({ kind: "absent" }), bytes: 0 };
        entry.result = resolve(assetId, pool).then(
            result => {
                if (disposed) {
                    return result;
                }
                if (result.kind === "bytes") {
                    entry.bytes = result.bytes.length;
                    retained += entry.bytes;
                    evict(key);
                } else {
                    options.onRefusal?.(assetId, result.kind);
                }
                return result;
            },
            thrown => {
                const result: AssetBytesResult = { kind: "failed", reason: messageOf(thrown) };
                if (!disposed) {
                    options.onRefusal?.(assetId, "failed");
                }
                return result;
            },
        );
        cache.set(key, entry);
        return entry.result;
    }

    return {
        id: options.id,
        read,
        dispose() {
            disposed = true;
            cache.clear();
            shardsAtVersion.clear();
            setsAtVersion = null;
            retained = 0;
        },
        get retainedBytes() {
            return retained;
        },
    };
}

/**
 * Fatal rather than lenient, for `sideDocument.ts`'s reason: a decoder that substitutes U+FFFD
 * turns a truncated file into one that parses to something nobody wrote.
 */
function decodeUtf8(bytes: Uint8Array): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * What to label a blob, sniffed from its first bytes.
 *
 * Content files carry no extension, so the bytes are the only evidence there is. Images go through
 * `bitmapMediaType`, which is already the canvas's answer to this question and already excludes the
 * formats Chromium has no decoder for; the rest of the table is the containers a page can play or
 * render text with, because an untyped blob in a video element or a `FontFace` does not load.
 *
 * Null is a real answer and means "unlabelled", which is what the live ladder hands every blob it
 * makes - an image element sniffs for itself.
 */
export function versionedMediaType(bytes: Uint8Array): string | null {
    const bitmap = bitmapMediaType(bytes);
    if (bitmap) {
        return bitmap;
    }
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
        return "audio/wav";
    }
    if (ascii(bytes, 0, 4) === "OggS") {
        return "audio/ogg";
    }
    if (ascii(bytes, 0, 3) === "ID3" || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
        return "audio/mpeg";
    }
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
        // Matroska, which in a project is all but always WebM. The type decides which decoder the
        // element reaches for, and "video/webm" is the one Chromium has.
        return "video/webm";
    }
    if (ascii(bytes, 4, 4) === "ftyp") {
        return "video/mp4";
    }
    if (ascii(bytes, 0, 4) === "wOFF") {
        return "font/woff";
    }
    if (ascii(bytes, 0, 4) === "wOF2") {
        return "font/woff2";
    }
    if (ascii(bytes, 0, 4) === "OTTO") {
        return "font/otf";
    }
    if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) {
        return "font/ttf";
    }
    return null;
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
    if (bytes.length < at + length) {
        return "";
    }
    let out = "";
    for (let index = at; index < at + length; index++) {
        out += String.fromCharCode(bytes[index]);
    }
    return out;
}
