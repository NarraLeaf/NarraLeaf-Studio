import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { resolveImageCompression, type AssetCompressionConfiguration } from "@shared/types/assetCompression";
import {
    planAssetImageTranscode,
    assetImageWorthKeeping,
    type AssetImageTranscodePlan,
} from "@shared/utils/assetImageOptimization";
import { readImageDimensions } from "@shared/utils/imageDimensions";
import { stripImageMetadata } from "@shared/utils/assetImageMetadata";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { characterAvatarAssetId } from "@shared/utils/characterAvatar";
import type { WebImageCodec, WebImageSourceType } from "./webImageCodec";

/**
 * Re-encode the project's images once, before anything is compiled, and hand the
 * compiles a file to copy in place of each source.
 *
 * It runs ahead of the compiles rather than over their output because of where
 * the bytes go. A web export writes loose files that can be rewritten afterwards,
 * but a protected desktop pack streams every asset into a sealed store as it
 * copies it, and there is nothing left to rewrite once that is done. Optimizing
 * beforehand is the only arrangement under which protection makes no difference
 * to what an author gets, and "the same build, minus protection, ships different
 * bytes" is exactly the kind of difference nobody would ever find.
 *
 * It also means one pass serves every target. The desktop pack, the static site
 * the browser and both mobile shells are built from, and any patch made later
 * all read the same optimized file, so a build cannot ship one edition of an
 * image to one platform and another edition to the next.
 *
 * Nothing here touches the project. The results live in Studio's own cache,
 * keyed by the source bytes, and the author's files are only ever read.
 */

/** What a compile should copy for one asset, in place of the file in the project. */
export type OptimizedAssetImage = {
    /** Absolute path to the replacement bytes, in the cache. */
    path: string;
    /**
     * Absent when the replacement is the same format as the source.
     *
     * An image that was only stripped of its metadata is still the file it was -
     * a PNG with its EXIF gone is a PNG - so it ships under the extension and
     * media type the manifest already states, and saying nothing here is how the
     * compiler is told to keep them.
     */
    ext?: "webp";
    mimeType?: "image/webp";
};

export type AssetImageOptimizationResult = {
    /** Asset id -> the file to copy instead. Assets that are absent were left alone. */
    images: Record<string, OptimizedAssetImage>;
    /** Images whose re-encoded form was kept. */
    converted: number;
    /** Images that were tried and whose original was kept anyway. */
    keptOriginal: number;
    /** Of {@link converted}, how many came back from the cache without being encoded again. */
    reused: number;
    /** Total size of the converted images before, and after. */
    beforeBytes: number;
    afterBytes: number;
    /** Images that were not re-encoded but did carry metadata worth removing. */
    stripped: number;
    /**
     * Bytes {@link stripped} saved. A converted image's saving is already in
     * {@link afterBytes}, so counting it here too would report it twice.
     */
    metadataBytes: number;
};

export type AssetImageOptimizationLog = (level: "info" | "warning", message: string) => void;

export type AssetImageOptimizationInput = {
    projectPath: string;
    /** Where re-encoded images are kept between builds. Studio's, never the project's. */
    cacheDir: string;
    config: AssetCompressionConfiguration;
    /**
     * Opened on the first image that actually needs encoding, so a build whose
     * images are all in the cache never starts a codec window at all - and a
     * host that cannot open one still builds, as long as it has nothing to do.
     */
    openCodec: () => Promise<WebImageCodec>;
    log: AssetImageOptimizationLog;
    cancelled?: () => boolean;
    /**
     * How far through the library this pass is, once per image.
     *
     * A callback rather than a channel of its own: this runs on the main process, where the caller
     * is the build that wants the number and is one frame away from the window that shows it. The
     * total is settled before the first image is read - the library's own listing plus the baked
     * avatars - which is what makes a count here a measurement rather than an extrapolation.
     */
    onProgress?: (done: number, total: number) => void;
};

/**
 * Bumped when a change here would make a cached result wrong rather than merely
 * out of date.
 *
 * It is not the Chromium version. Encoder output does drift between Chromium
 * releases, but a cached lossless result was compared against its source pixel
 * for pixel before it was written, so it stays correct however the encoder
 * changes; keying on the engine would re-encode an author's whole library after
 * every Electron bump to arrive at the same guarantee.
 *
 * 2: every result now passes through the metadata strip. An entry written before
 * that could still be carrying an author's name or a camera's serial number, and
 * "no metadata ships" is not a promise that can hold while a stale cache entry
 * is allowed to answer for an image.
 */
const CACHE_VERSION = 2;

/** How many "verification failed" warnings are worth printing before they stop being news. */
const MAX_VERIFICATION_WARNINGS = 3;

/**
 * How long an unused entry is kept.
 *
 * The key is the source bytes, so editing a sprite does not replace its entry -
 * it adds a second one, and the first is never asked for again. Without an age
 * this directory would only ever grow, one copy per version of every image an
 * author has ever built. Every entry is re-obtainable by encoding it again, so
 * the cost of forgetting one too early is measured in seconds.
 */
const MAX_UNUSED_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** The metadata file listing the assets this pass can do anything with. */
const IMAGE_METADATA_FILENAME = "assets.metadata.image.json";

type AssetMetadataRecord = {
    id?: unknown;
    name?: unknown;
};

export async function optimizeProjectImages(
    input: AssetImageOptimizationInput,
): Promise<AssetImageOptimizationResult> {
    const result: AssetImageOptimizationResult = {
        images: {},
        converted: 0,
        keptOriginal: 0,
        reused: 0,
        beforeBytes: 0,
        afterBytes: 0,
        stripped: 0,
        metadataBytes: 0,
    };
    // A holder rather than a plain local: it is assigned inside the closure below,
    // which the compiler cannot follow, and a bare `let` would still read as null here.
    const codec: { open: WebImageCodec | null } = { open: null };
    let verificationWarnings = 0;

    /**
     * For an image no transcode will touch: take out what it says about who made
     * it, and leave the picture exactly as it was.
     *
     * This is the path that matters most, because of which images reach it. Every
     * reason the transcode plan gives for skipping an image - a colour-managed one,
     * an APNG, a JPEG with lossy re-encoding off - describes artwork that ships
     * byte for byte as the artist saved it, EXIF and all. A pass that only cleaned
     * up the images it was already rewriting would clean up exactly the ones whose
     * metadata a re-encode had removed anyway.
     */
    const stripOnly = async (id: string, bytes: Buffer): Promise<void> => {
        const key = cacheKey(bytes, "strip", "");
        const cached = await readCached(input.cacheDir, key, "strip");
        if (cached === "rejected") {
            return;
        }
        if (cached) {
            result.images[id] = strippedImage(cached.path);
            result.stripped += 1;
            result.metadataBytes += bytes.length - cached.size;
            return;
        }
        const cleaned = stripImageMetadata(bytes);
        if (cleaned.removed.length === 0) {
            // Recorded rather than simply returned: most of an author's library
            // carries nothing, and without a note of that every build reads and
            // walks every one of those images again to reach the same answer.
            await writeRejected(input.cacheDir, key);
            return;
        }
        const kept = await writeCached(input.cacheDir, key, "strip", cleaned.bytes);
        if (!kept) {
            // A cache that cannot be written costs this image its strip and
            // nothing else; the original ships, as it did before.
            return;
        }
        result.images[id] = strippedImage(kept);
        result.stripped += 1;
        result.metadataBytes += cleaned.bytesRemoved;
    };
    /**
     * One image, from reading its bytes to recording what a compile should copy.
     *
     * Sequential on purpose, and this is why the walks below await it one file at
     * a time. Each image holds its decoded bitmap plus two full RGBA buffers for
     * the comparison - roughly 24 bytes per pixel at the peak, which for a 4K
     * sprite is already a couple of hundred megabytes. Running several at once
     * would multiply that against a saving measured in seconds, on a step that is
     * already the smaller half of a production build.
     */
    const consider = async (id: string, sourcePath: string, name: string): Promise<void> => {
        let bytes: Buffer;
        try {
            bytes = await fs.readFile(sourcePath);
        } catch {
            // An asset the library lists and the disk does not have. The compile
            // reports that properly, naming the asset and where it looked; this
            // step has nothing to add and no business failing the build first.
            return;
        }
        const plan = planAssetImageTranscode({ manifestKey: id, assetType: "image", bytes }, input.config);
        if (plan.action === "skip") {
            await stripOnly(id, bytes);
            return;
        }
        const sourceType = sourceTypeOf(bytes);
        if (!sourceType) {
            await stripOnly(id, bytes);
            return;
        }

        const key = cacheKey(bytes, plan.action, plan.action === "lossy" ? lossyMode(plan) : "");
        const cached = await readCached(input.cacheDir, key, plan.action);
        if (cached === "rejected") {
            result.keptOriginal += 1;
            return;
        }
        if (cached) {
            result.images[id] = transcodedImage(cached.path);
            result.converted += 1;
            result.reused += 1;
            result.beforeBytes += bytes.length;
            result.afterBytes += cached.size;
            return;
        }

        codec.open ??= await input.openCodec();
        const encoded = await codec.open.encode({
            bytes,
            sourceType,
            lossless: plan.action === "lossless",
            ...(plan.action === "lossy" ? { quality: plan.quality } : {}),
            ...(plan.action === "lossy" && plan.resizeTo ? { resizeTo: plan.resizeTo } : {}),
        });
        if (!encoded) {
            await writeRejected(input.cacheDir, key);
            result.keptOriginal += 1;
            return;
        }
        // The guarantee, enforced rather than assumed: a lossless conversion
        // that does not decode back to the source pixels is thrown away. If this
        // ever starts firing the engine's behaviour has changed underneath us,
        // and the right outcome is a bigger build, not an altered one.
        if (plan.action === "lossless" && !encoded.verifiedLossless) {
            await writeRejected(input.cacheDir, key);
            result.keptOriginal += 1;
            if (verificationWarnings < MAX_VERIFICATION_WARNINGS) {
                verificationWarnings += 1;
                input.log("warning", `"${name}" did not survive a lossless round trip; it ships unchanged`);
            }
            return;
        }
        // Belt and braces: an encoder that decoded the source to a bitmap has no
        // metadata left to carry, so this is expected to find nothing. It runs
        // anyway because "nothing ships metadata" should not rest on an
        // assumption about a dependency we do not control, and finding nothing
        // costs one pass over bytes that were just produced.
        const cleaned = stripImageMetadata(encoded.bytes);
        if (!assetImageWorthKeeping(bytes.length, cleaned.bytes.length)) {
            await writeRejected(input.cacheDir, key);
            result.keptOriginal += 1;
            return;
        }
        const kept = await writeCached(input.cacheDir, key, plan.action, cleaned.bytes);
        if (!kept) {
            result.keptOriginal += 1;
            return;
        }
        result.images[id] = transcodedImage(kept);
        result.converted += 1;
        result.beforeBytes += bytes.length;
        result.afterBytes += cleaned.bytes.length;
    };

    const metadata = await readOptionalJson<Record<string, AssetMetadataRecord>>(
        path.join(input.projectPath, "assets", IMAGE_METADATA_FILENAME),
    );
    const listed = Object.entries(metadata ?? {});
    // The baked avatars, which the library does not list: they are derived
    // project files under a synthetic id, and the compiler copies them in a walk
    // of its own. They are also PNG by construction and shown on almost every
    // line of dialogue, so leaving them out would exempt the images a player
    // looks at most.
    //
    // Found before either walk begins rather than between them, so how much work this pass has is
    // known before it starts any. A total discovered halfway through would make the readout slide
    // backwards at the moment the avatars were added to it.
    const avatars = await bakedAvatars(input.projectPath);
    const total = listed.length + avatars.length;
    let considered = 0;
    const advance = (): void => {
        considered += 1;
        input.onProgress?.(considered, total);
    };
    if (total > 0) {
        // Announced before the first image so the readout is determinate for the whole pass. A
        // project with no images says nothing rather than opening a count of zero, which is not a
        // fraction anything can draw.
        input.onProgress?.(0, total);
    }

    for (const [assetKey, record] of listed) {
        if (input.cancelled?.()) {
            break;
        }
        const id = typeof record?.id === "string" && record.id.trim() ? record.id.trim() : assetKey;
        const sourcePath = assetSourcePath(input.projectPath, id);
        if (sourcePath) {
            await consider(id, sourcePath, assetName(record, id));
        }
        advance();
    }

    for (const avatar of avatars) {
        if (input.cancelled?.()) {
            break;
        }
        await consider(avatar.id, avatar.path, avatar.name);
        advance();
    }

    await codec.open?.close().catch(() => undefined);
    await pruneCache(input.cacheDir);
    return result;
}

/**
 * Every baked character avatar on disk, addressed by the id the compiler will
 * look one up under.
 *
 * The directory layout is mirrored from `copyBakedCharacterAvatars`, which walks
 * the same tree when it copies them. The id derivation is not mirrored but
 * shared, and that is the half that has to agree: an id derived differently here
 * would produce overrides nothing ever looks up, and the build would quietly
 * ship the PNGs.
 */
async function bakedAvatars(
    projectPath: string,
): Promise<Array<{ id: string; path: string; name: string }>> {
    const root = path.join(projectPath, "resources", "characters", "avatars");
    let characterDirs: string[];
    try {
        characterDirs = (await fs.readdir(root, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    } catch {
        return [];
    }
    const avatars: Array<{ id: string; path: string; name: string }> = [];
    for (const characterId of characterDirs) {
        const dir = path.join(root, characterId);
        const files = (await fs.readdir(dir).catch(() => []))
            .filter(name => name.toLowerCase().endsWith(".png"));
        for (const fileName of files) {
            const key = fileName.slice(0, -".png".length);
            avatars.push({
                id: characterAvatarAssetId(characterId, key),
                path: path.join(dir, fileName),
                name: `${characterId}/${key}`,
            });
        }
    }
    return avatars;
}

/**
 * Drop entries nothing has asked for in a long time.
 *
 * Best effort throughout: a cache that cannot be tidied is a cache that takes
 * more disk than it needs to, which is not a reason to fail a build that has
 * already produced its bytes.
 */
async function pruneCache(cacheDir: string): Promise<void> {
    const cutoff = Date.now() - MAX_UNUSED_AGE_MS;
    let shards: string[];
    try {
        shards = await fs.readdir(cacheDir);
    } catch {
        return;
    }
    for (const shard of shards) {
        const shardDir = path.join(cacheDir, shard);
        let entries: string[];
        try {
            entries = await fs.readdir(shardDir);
        } catch {
            continue;
        }
        let remaining = entries.length;
        for (const entry of entries) {
            const entryPath = path.join(shardDir, entry);
            try {
                const stats = await fs.stat(entryPath);
                if (stats.mtimeMs >= cutoff) {
                    continue;
                }
                await fs.rm(entryPath, { force: true });
                remaining -= 1;
            } catch {
                // Gone already, or held open by another build; either way it is
                // not this pass's to insist on.
            }
        }
        if (remaining <= 0) {
            await fs.rmdir(shardDir).catch(() => undefined);
        }
    }
}

/** A transcoded image ships as WebP; a stripped one keeps whatever it already was. */
function transcodedImage(filePath: string): OptimizedAssetImage {
    return { path: filePath, ext: "webp", mimeType: "image/webp" };
}

function strippedImage(filePath: string): OptimizedAssetImage {
    return { path: filePath };
}

function assetName(record: AssetMetadataRecord, id: string): string {
    return typeof record?.name === "string" && record.name.trim() ? record.name.trim() : id;
}

/**
 * Where an asset's bytes are. Mirrors the compiler's own resolution, and answers
 * null for an id the storage layout cannot address rather than throwing: a
 * malformed record is the library's problem to report, not this pass's.
 */
function assetSourcePath(projectPath: string, id: string): string | null {
    try {
        const [a, b, rest] = splitAssetStorageId(id);
        return path.join(projectPath, "assets", "content", a, b, rest);
    } catch {
        return null;
    }
}

/**
 * The cache key: the source bytes, and what was asked of them.
 *
 * Content addressed rather than keyed by asset id, so re-importing the same
 * artwork, copying it into a second project, or building the same project from
 * another checkout all hit an entry that is already there. The quality rides in
 * the key because two qualities are two different images, and an author lowering
 * it and building again must not be shown the previous one.
 */
type CacheAction = "lossless" | "lossy" | "strip";

function cacheKey(bytes: Buffer, action: CacheAction, mode: string): string {
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    const prefix = action === "lossless" ? "l" : action === "strip" ? "s" : "";
    return `${digest}-${prefix}${mode}-v${CACHE_VERSION}`;
}

/**
 * Everything about a lossy encode that changes its bytes, as a key fragment.
 *
 * The size belongs in it as much as the quality does: an author who lowers the cap and builds again
 * must not be handed the larger image the previous build made, and the two settings are independent,
 * so neither can stand for the other.
 */
function lossyMode(plan: Extract<AssetImageTranscodePlan, { action: "lossy" }>): string {
    const size = plan.resizeTo ? `-${plan.resizeTo.width}x${plan.resizeTo.height}` : "";
    return `q${plan.quality}${size}`;
}

/**
 * The cache file's own name. It is for whoever opens the cache directory and
 * nothing else: a compile copies these bytes to a destination it names from the
 * manifest, so what the entry is called here never reaches a build.
 */
function cachedExtension(action: CacheAction): string {
    return action === "strip" ? ".stripped" : ".webp";
}

function cachePath(cacheDir: string, key: string, extension: string): string {
    return path.join(cacheDir, key.slice(0, 2), `${key}${extension}`);
}

/**
 * What the cache knows about this image: the kept file, "tried and not worth
 * keeping", or nothing.
 *
 * The rejections are cached too, and that is not a micro-optimization. Real
 * artwork contains images that come out *larger* as WebP, and without a record
 * of that every one of them is decoded, encoded and compared again on every
 * build, forever, to reach the same answer.
 */
async function readCached(
    cacheDir: string,
    key: string,
    action: CacheAction,
): Promise<{ path: string; size: number } | "rejected" | null> {
    const keptPath = cachePath(cacheDir, key, cachedExtension(action));
    try {
        const stats = await fs.stat(keptPath);
        if (stats.isFile() && stats.size > 0) {
            await touch(keptPath);
            return { path: keptPath, size: stats.size };
        }
    } catch {
        // Not cached; fall through.
    }
    const rejectedPath = cachePath(cacheDir, key, ".rejected");
    try {
        await fs.access(rejectedPath);
        await touch(rejectedPath);
        return "rejected";
    } catch {
        return null;
    }
}

/** Mark an entry as still wanted, so {@link pruneCache} keeps it. */
async function touch(filePath: string): Promise<void> {
    const now = new Date();
    await fs.utimes(filePath, now, now).catch(() => undefined);
}

/**
 * Write the kept bytes, and answer with the path a compile should copy - or null
 * if the cache could not be written, which costs this image its conversion and
 * nothing else.
 *
 * Written to a temporary name and renamed, because a build killed mid-write must
 * not leave behind a truncated file that every later build reads as a finished
 * one and ships.
 */
async function writeCached(
    cacheDir: string,
    key: string,
    action: CacheAction,
    bytes: Uint8Array,
): Promise<string | null> {
    const target = cachePath(cacheDir, key, cachedExtension(action));
    const temporary = `${target}.${process.pid}.part`;
    try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(temporary, bytes);
        await fs.rename(temporary, target);
        return target;
    } catch {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        return null;
    }
}

async function writeRejected(cacheDir: string, key: string): Promise<void> {
    const target = cachePath(cacheDir, key, ".rejected");
    try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, "");
    } catch {
        // A cache that cannot be written costs time on the next build, never
        // correctness on this one.
    }
}

/**
 * The media type to hand the decoder, read from the bytes.
 *
 * Taken from the content rather than from the record's `ext`, for the same
 * reason the transcode plan is: the extension is authored metadata and the
 * bytes are the fact, and telling a decoder that a JPEG is a PNG is a decode
 * failure at best.
 */
function sourceTypeOf(bytes: Buffer): WebImageSourceType | null {
    switch (readImageDimensions(bytes)?.format) {
        case "png":
            return "image/png";
        case "jpeg":
            return "image/jpeg";
        default:
            return null;
    }
}

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
    } catch {
        return null;
    }
}
