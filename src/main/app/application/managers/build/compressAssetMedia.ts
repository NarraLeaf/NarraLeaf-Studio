import crypto from "crypto";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import {
    assetTrackEnabled,
    type AssetCompressionConfiguration,
} from "@shared/types/assetCompression";
import { mediaMetadataLikely, stripMediaMetadata } from "@shared/utils/assetMediaMetadata";
import {
    assetMediaWorthKeeping,
    planAssetMediaCompression,
    type AssetMediaCompressionPlan,
} from "@shared/utils/assetMediaCompression";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { probeDurationUs, type ProbeReport } from "@shared/utils/mediaSupport";
import { probeMediaReport, type ProbeRunner } from "../media/mediaProbe";
import { compressionArgs, startMediaEncode, type MediaTranscodeOptions } from "../media/mediaTranscode";
import { resolveFfmpegBinary, type FfmpegResolveOptions, type FfmpegResolverApp } from "../media/ffmpegTool";

/**
 * Re-encode the project's sound and video once, before anything is compiled, and
 * hand the compiles a file to copy in place of each source.
 *
 * The arrangement is the one the image pass established and for the same
 * reasons. It runs ahead of the compiles because a protected desktop pack
 * streams every asset into a sealed store as it copies it, leaving nothing to
 * rewrite afterwards; doing the work first is the only shape under which
 * protection makes no difference to what an author ships. It also means one pass
 * serves the desktop pack, the static site both mobile shells and the browser
 * are built from, and any patch made later, so no two targets can ever receive
 * different editions of the same track.
 *
 * Nothing here writes to the project. Results live in Studio's own cache, keyed
 * by the source bytes, and the author's files are only ever read. The masters
 * stay exactly as they were imported - what is compressed is the copy that
 * ships.
 *
 * ## Why this is a second pass rather than part of the image one
 *
 * They share almost nothing but their shape. Images are decoded in a hidden
 * Chromium window, entirely in memory, and verified pixel for pixel; media is
 * re-encoded by a vendored FFmpeg in a child process, streams to disk, and can
 * take minutes for one file. The two failure modes are different, the two hosts
 * that can be missing are different, and a build must be able to lose either one
 * without losing the other.
 */

/** What a compile should copy for one asset, in place of the file in the project. */
export type CompressedAssetMedia = {
    /** Absolute path to the replacement bytes, in the cache. */
    path: string;
    /**
     * Both absent when the replacement is the same kind of file as the source -
     * a recording whose tags were removed without re-encoding it. The manifest
     * already states what that file is, and restating it here would be a second
     * place for the two to disagree.
     */
    ext?: string;
    mimeType?: string;
};

export type AssetMediaCompressionResult = {
    /** Asset id -> the file to copy instead. Assets that are absent were left alone. */
    media: Record<string, CompressedAssetMedia>;
    /** Files whose re-encoded form was kept. */
    converted: number;
    /** Files that were tried and whose original was kept anyway. */
    keptOriginal: number;
    /** Of {@link converted}, how many came back from the cache without being encoded again. */
    reused: number;
    /** Total size of the converted files before, and after. */
    beforeBytes: number;
    afterBytes: number;
    /** Files that were not re-encoded but did carry metadata worth removing. */
    stripped: number;
    /**
     * Bytes {@link stripped} saved. A re-encoded file's tags are gone as part of
     * its own saving, so counting them here too would report them twice.
     */
    metadataBytes: number;
};

export type AssetMediaCompressionLog = (level: "info" | "warning", message: string) => void;

export type AssetMediaCompressionInput = {
    projectPath: string;
    /** Where re-encoded media is kept between builds. Studio's, never the project's. */
    cacheDir: string;
    config: AssetCompressionConfiguration;
    /** Resolves the vendored ffmpeg and ffprobe for this host. */
    app: FfmpegResolverApp;
    log: AssetMediaCompressionLog;
    cancelled?: () => boolean;
    /**
     * How far through the library this pass is, once per file.
     *
     * A callback rather than a channel of its own, for the reason the image pass gives: this runs
     * on the main process, beside the build that wants the number. Both metadata files are read
     * before the first probe, so the total is a fact rather than a guess that grows.
     */
    onProgress?: (done: number, total: number) => void;
    /** Injected in tests; how the vendored binaries are located. */
    ffmpeg?: FfmpegResolveOptions;
    /** Injected in tests; defaults to running the resolved ffprobe. */
    probeRun?: ProbeRunner;
    /** Injected in tests; defaults to a real spawn of the resolved ffmpeg. */
    encodeOptions?: MediaTranscodeOptions;
};

/**
 * Bumped when a change here would make a cached result wrong rather than merely
 * out of date.
 *
 * Not the FFmpeg version. A cached result is a file that was measured against
 * its source and kept because it was enough smaller; a newer encoder producing a
 * slightly different file of the same quality does not make the stored one
 * wrong, and keying on the binary would re-encode an author's entire voice
 * library after every dependency bump to arrive at the same answer.
 */
const CACHE_VERSION = 1;

/**
 * How long an unused entry is kept.
 *
 * The key is the source bytes, so re-recording a line does not replace its entry
 * - it adds a second one, and the first is never asked for again. Every entry is
 * re-obtainable by encoding it again, so the cost of forgetting one too early is
 * measured in seconds.
 */
const MAX_UNUSED_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** How many encoder failures are worth printing before they stop being news. */
const MAX_FAILURE_WARNINGS = 3;

/**
 * How much of each end of a file is enough to tell whether it carries tags.
 *
 * Generous on both sides rather than tight: an ID3v2 tag with a cover in it runs
 * to hundreds of kilobytes, and a WAV can carry a long chunk list before its
 * samples. Reading a little too much costs nothing measurable next to reading
 * the file.
 */
const METADATA_HEAD_BYTES = 256 * 1024;
const METADATA_TAIL_BYTES = 64 * 1024;

/** The cache file's own extension for a file that was only stripped, never re-encoded. */
const STRIPPED_EXTENSION = ".stripped";

/** The two metadata shards holding assets this pass can do anything with. */
const MEDIA_ASSET_TYPES = ["audio", "video"] as const;

type AssetMetadataRecord = {
    id?: unknown;
    name?: unknown;
};

export async function compressProjectMedia(
    input: AssetMediaCompressionInput,
): Promise<AssetMediaCompressionResult> {
    const result: AssetMediaCompressionResult = {
        media: {},
        converted: 0,
        keptOriginal: 0,
        reused: 0,
        beforeBytes: 0,
        afterBytes: 0,
        stripped: 0,
        metadataBytes: 0,
    };
    // Compression is a decision an author makes; taking the studio's name out of
    // a recording is not, so this pass runs whether or not either switch is on.
    // What the switches decide is whether anything is probed or encoded.
    const compressing = assetTrackEnabled(input.config, "audio") || assetTrackEnabled(input.config, "video");

    let binary: string | null = null;
    // Latched, so a host with no FFmpeg looks for it once and says so once,
    // rather than repeating itself for every file in the library. Two of them,
    // because the two binaries are staged and can go missing independently.
    let encoderUnavailable = false;
    let probeUnavailable = false;
    let failureWarnings = 0;

    /**
     * For a file no encode will touch: take out what it says about who made it,
     * and leave the sound exactly as it was.
     *
     * This is the path most of a project goes down, because it is the one a
     * project with compression switched off takes for every file it has.
     *
     * The ends of the file are read first and the whole of it only if they say
     * there is something to find. That ordering is the difference between a warm
     * build costing a few kilobytes per asset and costing a full read of every
     * recording in a fully voiced game - see `mediaMetadataLikely` for why a few
     * kilobytes are enough to answer.
     */
    const stripOnly = async (id: string, sourcePath: string, byteLength: number): Promise<void> => {
        const ends = await readEnds(sourcePath, byteLength);
        if (!ends || !mediaMetadataLikely(ends.head, ends.tail)) {
            return;
        }
        let bytes: Buffer;
        try {
            bytes = await fs.readFile(sourcePath);
        } catch {
            return;
        }
        const digest = crypto.createHash("sha256").update(bytes).digest("hex");
        const key = `${digest}-s-v${CACHE_VERSION}`;
        const cached = await readCached(input.cacheDir, key, STRIPPED_EXTENSION);
        if (cached === "rejected") {
            return;
        }
        if (cached) {
            result.media[id] = { path: cached.path };
            result.stripped += 1;
            result.metadataBytes += bytes.length - cached.size;
            return;
        }
        const cleaned = stripMediaMetadata(bytes);
        if (cleaned.removed.length === 0) {
            // Recorded rather than simply returned. The cheap check is allowed to
            // say yes when the answer is no, and without a note of that this file
            // is read in full on every build to reach the same answer.
            await writeRejected(input.cacheDir, key);
            return;
        }
        const kept = await writeCached(input.cacheDir, key, STRIPPED_EXTENSION, cleaned.bytes);
        if (!kept) {
            // A cache that cannot be written costs this file its strip and
            // nothing else; the original ships, as it did before.
            return;
        }
        result.media[id] = { path: kept };
        result.stripped += 1;
        result.metadataBytes += cleaned.bytesRemoved;
    };

    /**
     * One file, from its size to what a compile should copy.
     *
     * Sequential, and this is why the walk below awaits it one file at a time.
     * An encode already saturates the cores it was given - libvpx runs its own
     * row threads and the AAC encoder is I/O bound against a file being read and
     * a file being written - so running several would trade a build's memory and
     * disk bandwidth for no wall clock.
     */
    const consider = async (
        id: string,
        sourcePath: string,
        name: string,
        assetType: string,
    ): Promise<void> => {
        let byteLength: number;
        try {
            const stats = await fs.stat(sourcePath);
            if (!stats.isFile()) {
                return;
            }
            byteLength = stats.size;
        } catch {
            // An asset the library lists and the disk does not have. The compile
            // reports that properly, naming the asset and where it looked; this
            // step has nothing to add and no business failing the build first.
            return;
        }

        if (!compressing || probeUnavailable) {
            // A host with no ffprobe still gets the metadata pass, which needs no
            // binary at all - and it is checked before the file is hashed, because
            // hashing a voice library to ask a question already answered is the
            // expensive way to do nothing.
            await stripOnly(id, sourcePath, byteLength);
            return;
        }

        const digest = await hashFile(sourcePath);
        if (digest === null) {
            return;
        }

        const report = await describe(sourcePath, digest);
        if (report === null) {
            // No verdict, so nothing to re-encode - but the metadata pass reads
            // the bytes itself and does not care what ffprobe thinks, so the file
            // still gets that half rather than shipping exactly as it arrived.
            await stripOnly(id, sourcePath, byteLength);
            return;
        }
        const plan = planAssetMediaCompression(
            { manifestKey: id, assetType, byteLength, report },
            input.config,
        );
        if (plan.action === "skip") {
            // Everything the plan refuses - a track whose switch is off, a video
            // carrying alpha, a file too small to be worth a process - ships as
            // the author saved it, tags and all, unless this takes them out. It
            // is the path most of a project goes down, so it is the one that
            // matters most.
            await stripOnly(id, sourcePath, byteLength);
            return;
        }

        const key = `${digest}-${modeOf(plan)}-v${CACHE_VERSION}`;
        const extension = extensionFor(plan.action);
        const cached = await readCached(input.cacheDir, key, extension);
        if (cached === "rejected") {
            result.keptOriginal += 1;
            return;
        }
        if (cached) {
            result.media[id] = shipped(cached.path, plan.action);
            result.converted += 1;
            result.reused += 1;
            result.beforeBytes += byteLength;
            result.afterBytes += cached.size;
            return;
        }

        if (encoderUnavailable || probeUnavailable) {
            return;
        }
        if (binary === null) {
            // Resolved on the first file that actually needs encoding, so a build
            // whose media is all cached never looks for a binary, and a host
            // without one still builds as long as it has nothing to do.
            const tool = await resolveEncoder(input);
            if (!tool) {
                encoderUnavailable = true;
                return;
            }
            binary = tool;
        }
        if (plan.action === "video") {
            // Video only. One line per voice file would bury a build log under ten
            // thousand of them, while one video can hold a build for minutes and
            // an author watching a still progress bar deserves to know why.
            input.log("info", `compressing "${name}"`);
        }

        const target = cachePath(input.cacheDir, key, extension);
        try {
            await fs.mkdir(path.dirname(target), { recursive: true });
        } catch {
            // A cache that cannot be written costs this file its compression and
            // nothing else; the original ships, as it did before.
            result.keptOriginal += 1;
            return;
        }

        const handle = startMediaEncode(binary, {
            sourcePath,
            targetPath: target,
            buildArgs: outputPath => compressionArgs(plan, sourcePath, outputPath),
            durationUs: probeDurationUs(report),
        }, input.encodeOptions ?? {});
        // A build cancelled mid-encode stops the encoder rather than waiting it
        // out: a 4K clip is minutes of work nobody is going to use.
        const poll = input.cancelled
            ? setInterval(() => {
                if (input.cancelled?.()) {
                    handle.cancel();
                }
            }, 250)
            : null;
        let encoded;
        try {
            encoded = await handle.result;
        } finally {
            if (poll) {
                clearInterval(poll);
            }
        }

        if (encoded.status === "cancelled") {
            return;
        }
        if (encoded.status === "error") {
            result.keptOriginal += 1;
            // Recorded as a rejection so a file the encoder cannot read is not
            // retried on every build, and warned about at most a few times: one
            // broken import can be a whole directory of them.
            await writeRejected(input.cacheDir, key);
            if (failureWarnings < MAX_FAILURE_WARNINGS) {
                failureWarnings += 1;
                input.log("warning", `"${name}" could not be compressed and ships unchanged: ${encoded.detail}`);
            }
            return;
        }

        let encodedBytes: number;
        try {
            encodedBytes = (await fs.stat(target)).size;
        } catch {
            result.keptOriginal += 1;
            return;
        }
        if (!assetMediaWorthKeeping(byteLength, encodedBytes, plan.lossySource)) {
            // Thrown away and remembered as thrown away. Real projects contain
            // tracks that come out larger, and without a record of that every one
            // of them is re-encoded on every build to reach the same answer.
            await fs.rm(target, { force: true }).catch(() => undefined);
            await writeRejected(input.cacheDir, key);
            result.keptOriginal += 1;
            return;
        }

        result.media[id] = shipped(target, plan.action);
        result.converted += 1;
        result.beforeBytes += byteLength;
        result.afterBytes += encodedBytes;
    };

    /**
     * What ffprobe says about a file, remembered by its bytes.
     *
     * The probe result is cached separately from the encode, and that separation
     * is what keeps a build with a warm cache from spawning one process per voice
     * line. The encode's key has to carry the quality; this one must not, so that
     * changing the video quality does not re-probe every audio file in the
     * project to learn what it already knew.
     */
    const describe = async (sourcePath: string, digest: string): Promise<ProbeReport | null> => {
        const probePath = cachePath(input.cacheDir, `${digest}-v${CACHE_VERSION}`, ".probe.json");
        try {
            const cached = JSON.parse(await fs.readFile(probePath, "utf-8")) as ProbeReport;
            await touch(probePath);
            return cached;
        } catch {
            // Not probed yet, or a half-written entry; either way, ask again.
        }
        const outcome = await probeMediaReport(input.app, sourcePath, {
            ...input.ffmpeg,
            ...(input.probeRun ? { run: input.probeRun } : {}),
        });
        if (outcome.status !== "probed") {
            if (outcome.status === "unavailable") {
                // Latched, and latched separately from the per-file warnings: a
                // host with no ffprobe has one thing wrong with it, not one thing
                // wrong per file in the library.
                if (!probeUnavailable) {
                    probeUnavailable = true;
                    input.log("warning", `media compression is unavailable on this host: ${outcome.detail}`);
                }
                return null;
            }
            if (failureWarnings < MAX_FAILURE_WARNINGS) {
                failureWarnings += 1;
                input.log("warning", `"${sourcePath}" could not be read: ${outcome.detail}`);
            }
            return null;
        }
        try {
            await fs.mkdir(path.dirname(probePath), { recursive: true });
            const temporary = `${probePath}.${process.pid}.part`;
            await fs.writeFile(temporary, JSON.stringify(outcome.report));
            await fs.rename(temporary, probePath);
        } catch {
            // Costs a probe on the next build, never correctness on this one.
        }
        return outcome.report;
    };

    // Both listings first, then the work: a total that arrived only when the video listing was
    // reached would make the readout jump backwards halfway through a project that has both.
    const listings = await Promise.all(MEDIA_ASSET_TYPES.map(async type => ({
        type,
        records: Object.entries(await readOptionalJson<Record<string, AssetMetadataRecord>>(
            path.join(input.projectPath, "assets", `assets.metadata.${type}.json`),
        ) ?? {}),
    })));
    const total = listings.reduce((sum, listing) => sum + listing.records.length, 0);
    let considered = 0;
    if (total > 0) {
        // A project with no sound and no video opens no count: zero of zero is not a fraction.
        input.onProgress?.(0, total);
    }

    for (const { type, records } of listings) {
        for (const [assetKey, record] of records) {
            if (input.cancelled?.()) {
                break;
            }
            const id = typeof record?.id === "string" && record.id.trim() ? record.id.trim() : assetKey;
            const sourcePath = assetSourcePath(input.projectPath, id);
            if (sourcePath) {
                await consider(id, sourcePath, assetName(record, id), type);
            }
            considered += 1;
            input.onProgress?.(considered, total);
        }
    }

    await pruneCache(input.cacheDir);
    return result;
}

async function resolveEncoder(input: AssetMediaCompressionInput): Promise<string | null> {
    const tool = await resolveFfmpegBinary(input.app, "ffmpeg", input.ffmpeg ?? {});
    if (tool.available) {
        return tool.path;
    }
    // Never fatal. This is an improvement on a build that already works, so a
    // host with no encoder costs the author some bytes and a warning, not their
    // build.
    input.log("warning", `media compression is unavailable on this host: ${tool.detail}`);
    return null;
}

/**
 * Everything about an encode that changes its bytes, as a key fragment.
 *
 * Every parameter the plan carries has to be in it. An author who lowers a cap and builds again
 * must not be handed the file the previous settings produced, and no one of these settings can
 * stand for the others: they move independently.
 */
function modeOf(plan: Extract<AssetMediaCompressionPlan, { action: "audio" | "video" }>): string {
    if (plan.action === "audio") {
        return `a${plan.bitrateKbps}${plan.sampleRateHz === null ? "" : `r${plan.sampleRateHz}`}`;
    }
    return `v${plan.crf}${plan.maxHeight === null ? "" : `h${plan.maxHeight}`}`;
}

function extensionFor(action: "audio" | "video"): string {
    return action === "audio" ? ".m4a" : ".webm";
}

/**
 * What the manifest should say the shipped file is.
 *
 * AAC goes in an MP4 named `.m4a` rather than in WebM, and that is not a
 * preference. The iOS shell serves media types from a table of its own and that
 * table has no `audio/webm` in it, while WebKit does not sniff containers - a
 * `.weba` would be sent as `application/octet-stream` and would silently not
 * play on one of the four targets this single pass serves.
 */
function shipped(filePath: string, action: "audio" | "video"): CompressedAssetMedia {
    return action === "audio"
        ? { path: filePath, ext: "m4a", mimeType: "audio/mp4" }
        : { path: filePath, ext: "webm", mimeType: "video/webm" };
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
 * The source bytes, hashed by streaming.
 *
 * Streamed rather than read, because this pass is pointed at the largest files
 * in a project: a lossless soundtrack is tens of megabytes and a clip can be
 * hundreds, and holding one in the main process to hash it would be a spike the
 * build does not otherwise need.
 */
async function hashFile(filePath: string): Promise<string | null> {
    return new Promise(resolve => {
        const hash = crypto.createHash("sha256");
        const stream = createReadStream(filePath);
        stream.on("data", chunk => hash.update(chunk));
        stream.on("error", () => resolve(null));
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}

function cachePath(cacheDir: string, key: string, extension: string): string {
    return path.join(cacheDir, key.slice(0, 2), `${key}${extension}`);
}

/**
 * What the cache knows about this file: the kept encode, "tried and not worth
 * keeping", or nothing.
 */
async function readCached(
    cacheDir: string,
    key: string,
    extension: string,
): Promise<{ path: string; size: number } | "rejected" | null> {
    const keptPath = cachePath(cacheDir, key, extension);
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

/**
 * The first and last few kilobytes of a file, in one open.
 *
 * Null when the file cannot be read, which the caller treats as "nothing to do":
 * an asset the library lists and the disk does not have is the compile's to
 * report, naming it properly, and this step has nothing to add.
 */
async function readEnds(
    filePath: string,
    byteLength: number,
): Promise<{ head: Uint8Array; tail: Uint8Array } | null> {
    let handle;
    try {
        handle = await fs.open(filePath, "r");
    } catch {
        return null;
    }
    try {
        const headLength = Math.min(byteLength, METADATA_HEAD_BYTES);
        const head = Buffer.alloc(headLength);
        await handle.read(head, 0, headLength, 0);
        const tailLength = Math.min(byteLength, METADATA_TAIL_BYTES);
        const tailStart = Math.max(0, byteLength - tailLength);
        const tail = Buffer.alloc(tailLength);
        await handle.read(tail, 0, tailLength, tailStart);
        return { head, tail };
    } catch {
        return null;
    } finally {
        await handle.close().catch(() => undefined);
    }
}

/** Mark an entry as still wanted, so {@link pruneCache} keeps it. */
async function touch(filePath: string): Promise<void> {
    const now = new Date();
    await fs.utimes(filePath, now, now).catch(() => undefined);
}

/**
 * Write the kept bytes, and answer with the path a compile should copy - or null
 * if the cache could not be written.
 *
 * Written to a temporary name and renamed, because a build killed mid-write must
 * not leave behind a truncated file that every later build reads as a finished
 * one and ships.
 */
async function writeCached(
    cacheDir: string,
    key: string,
    extension: string,
    bytes: Uint8Array,
): Promise<string | null> {
    const target = cachePath(cacheDir, key, extension);
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

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
    } catch {
        return null;
    }
}
