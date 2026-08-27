import crypto from "crypto";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import {
    assetTrackCompression,
    type AssetCompressionConfiguration,
} from "@shared/types/assetCompression";
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
    /** Always set: a compressed copy is a different container from whatever it came from. */
    ext: string;
    mimeType: string;
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
    };
    // Both switches off is the common case and the whole pass is skippable: no
    // metadata is read, no binary is resolved, and a host with no FFmpeg builds
    // exactly as it did before without a word about it.
    if (!assetTrackCompression(input.config, "audio").enabled
        && !assetTrackCompression(input.config, "video").enabled) {
        return result;
    }

    let binary: string | null = null;
    // Latched, so a host with no FFmpeg looks for it once and says so once,
    // rather than repeating itself for every file in the library.
    let encoderUnavailable = false;
    let failureWarnings = 0;

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

        const digest = await hashFile(sourcePath);
        if (digest === null) {
            return;
        }

        const report = await describe(sourcePath, digest);
        if (report === null) {
            return;
        }
        const plan = planAssetMediaCompression(
            { manifestKey: id, assetType, byteLength, report },
            input.config,
        );
        if (plan.action === "skip") {
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

        if (encoderUnavailable) {
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
            if (outcome.status === "unavailable" && failureWarnings < MAX_FAILURE_WARNINGS) {
                failureWarnings += 1;
                input.log("warning", `media compression is unavailable on this host: ${outcome.detail}`);
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

    for (const type of MEDIA_ASSET_TYPES) {
        const metadata = await readOptionalJson<Record<string, AssetMetadataRecord>>(
            path.join(input.projectPath, "assets", `assets.metadata.${type}.json`),
        );
        for (const [assetKey, record] of Object.entries(metadata ?? {})) {
            if (input.cancelled?.()) {
                break;
            }
            const id = typeof record?.id === "string" && record.id.trim() ? record.id.trim() : assetKey;
            const sourcePath = assetSourcePath(input.projectPath, id);
            if (sourcePath) {
                await consider(id, sourcePath, assetName(record, id), type);
            }
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

function modeOf(plan: Extract<AssetMediaCompressionPlan, { action: "audio" | "video" }>): string {
    if (plan.action === "audio") {
        return `a${plan.bitrateKbps}${plan.sampleRateHz === null ? "" : `r${plan.sampleRateHz}`}`;
    }
    return `v${plan.crf}`;
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

/** Mark an entry as still wanted, so {@link pruneCache} keeps it. */
async function touch(filePath: string): Promise<void> {
    const now = new Date();
    await fs.utimes(filePath, now, now).catch(() => undefined);
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
