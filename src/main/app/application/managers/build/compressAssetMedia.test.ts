import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
    type AssetCompressionConfiguration,
} from "@shared/types/assetCompression";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { compressProjectMedia, type AssetMediaCompressionInput } from "./compressAssetMedia";
import { FFMPEG_DIR_ENV } from "../media/ffmpegTool";
import type { TranscodeChildProcess } from "../media/mediaTranscode";

const ASSET_A = "3f2a1c04-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
const ASSET_B = "7c8d9e0f-1a2b-4c3d-8e5f-6a7b8c9d0e1f";

const AUDIO_ON: AssetCompressionConfiguration = {
    ...DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
    compressAudio: true,
};

function le32(value: number): number[] {
    return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

function riffChunk(id: string, payload: number[]): Buffer {
    return Buffer.from([
        ...[...id].map(c => c.charCodeAt(0)),
        ...le32(payload.length),
        ...payload,
        ...(payload.length % 2 === 1 ? [0] : []),
    ]);
}

/** A real RIFF file, large enough that the "too small to bother" floor is never in play. */
function wavBytes(sampleCount = 400_000): Buffer {
    const body = Buffer.concat([
        riffChunk("fmt ", new Array(16).fill(0)),
        riffChunk("data", new Array(sampleCount).fill(7)),
    ]);
    return Buffer.concat([Buffer.from("RIFF"), Buffer.from(le32(4 + body.length)), Buffer.from("WAVE"), body]);
}

/** The same file with a studio's notes in it. */
function taggedWav(): Buffer {
    const info = riffChunk("LIST", [
        ...[..."INFO"].map(c => c.charCodeAt(0)),
        ...riffChunk("IART", [...[..."Someone Real"].map(c => c.charCodeAt(0)), 0, 0]),
    ]);
    const body = Buffer.concat([
        riffChunk("fmt ", new Array(16).fill(0)),
        info,
        riffChunk("data", new Array(400_000).fill(7)),
    ]);
    return Buffer.concat([Buffer.from("RIFF"), Buffer.from(le32(4 + body.length)), Buffer.from("WAVE"), body]);
}

let projectPath: string;
let cacheDir: string;
let binDir: string;
const log = vi.fn();

/** Where the compiler reads an asset's bytes from, mirrored so the test writes them there. */
function contentPath(id: string): string {
    const [a, b, rest] = splitAssetStorageId(id);
    return path.join(projectPath, "assets", "content", a, b, rest);
}

async function writeLibrary(
    type: "audio" | "video",
    assets: Record<string, { name?: string; bytes: Buffer }>,
): Promise<void> {
    const metadata: Record<string, unknown> = {};
    for (const [id, asset] of Object.entries(assets)) {
        metadata[id] = { id, name: asset.name ?? id, source: "local", ext: "wav" };
        const target = contentPath(id);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, asset.bytes);
    }
    await fs.mkdir(path.join(projectPath, "assets"), { recursive: true });
    await fs.writeFile(
        path.join(projectPath, "assets", `assets.metadata.${type}.json`),
        JSON.stringify(metadata),
        "utf-8",
    );
}

/**
 * An ffprobe that answers from a table rather than by reading anything, so a
 * test can state what is in a file without producing one.
 */
function fakeProbe(streams: Array<Record<string, unknown>>, calls?: { count: number }) {
    return async () => {
        if (calls) {
            calls.count += 1;
        }
        return {
            stdout: JSON.stringify({ format: { duration: "12.0" }, streams }),
            timedOut: false,
            error: null,
        };
    };
}

type FakeEncoderOptions = {
    /** Size of the encoded file as a fraction of the source. */
    ratio?: number;
    /** Exit non-zero, as ffmpeg does for a file it cannot read. */
    fail?: boolean;
};

/**
 * An ffmpeg that writes a file of the requested size and exits, without being
 * ffmpeg. The output path is read out of the argv, which is also what makes the
 * arguments themselves testable here.
 */
function fakeEncoder(options: FakeEncoderOptions = {}) {
    const invocations: string[][] = [];
    const spawnProcess = (_binary: string, args: string[]): TranscodeChildProcess => {
        invocations.push(args);
        const handlers: Record<string, Array<(...rest: never[]) => void>> = {};
        const outputPath = args[args.length - 1];
        const sourcePath = args[args.indexOf("-i") + 1];
        void (async () => {
            // Yield first, unconditionally: the caller registers its listeners on
            // the object this function is still returning, so a close fired in
            // this tick would land on nobody and the encode would never settle.
            await new Promise(resolve => setImmediate(resolve));
            if (!options.fail) {
                const source = await fs.stat(sourcePath);
                await fs.writeFile(outputPath, Buffer.alloc(Math.round(source.size * (options.ratio ?? 0.2)), 1));
            }
            for (const listener of handlers.close ?? []) {
                (listener as (code: number | null, signal: string | null) => void)(options.fail ? 1 : 0, null);
            }
        })();
        return {
            stdout: { on: () => undefined },
            stderr: { on: () => undefined },
            on(event: string, listener: (...rest: never[]) => void) {
                (handlers[event] ??= []).push(listener);
                return undefined;
            },
            kill: () => true,
        };
    };
    return { spawnProcess, invocations };
}

function run(over: Partial<AssetMediaCompressionInput> = {}) {
    const encoder = fakeEncoder();
    return compressProjectMedia({
        projectPath,
        cacheDir,
        config: AUDIO_ON,
        app: { isPackaged: () => true, resolveResource: p => path.join(binDir, p) },
        log,
        ffmpeg: { platform: "win32", arch: "x64", env: { [FFMPEG_DIR_ENV]: binDir } },
        probeRun: fakeProbe([{ index: 0, codec_type: "audio", codec_name: "pcm_s16le", sample_rate: "48000" }]),
        encodeOptions: { spawnProcess: encoder.spawnProcess },
        ...over,
    });
}

beforeEach(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-media-compress-"));
    projectPath = path.join(root, "project");
    cacheDir = path.join(root, "cache");
    binDir = path.join(root, "bin");
    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    // The resolver checks that the binaries are files before it hands back a
    // path; nothing ever runs them, because the spawn is injected.
    await fs.writeFile(path.join(binDir, "ffmpeg.exe"), "");
    await fs.writeFile(path.join(binDir, "ffprobe.exe"), "");
    log.mockClear();
});

afterEach(async () => {
    await fs.rm(path.dirname(projectPath), { recursive: true, force: true });
});

describe("compressProjectMedia", () => {
    it("answers with a cached file for a track that came out smaller", async () => {
        await writeLibrary("audio", { [ASSET_A]: { name: "Line 1", bytes: wavBytes() } });
        const result = await run();

        expect(result.converted).toBe(1);
        expect(result.beforeBytes).toBe(wavBytes().length);
        expect(result.afterBytes).toBe(Math.round(wavBytes().length * 0.2));
        // AAC in MP4, never WebM: the iOS shell's media-type table has no
        // audio/webm in it and WebKit does not sniff containers.
        expect(result.media[ASSET_A]).toMatchObject({ ext: "m4a", mimeType: "audio/mp4" });
        expect(result.media[ASSET_A].path.startsWith(cacheDir)).toBe(true);
        await expect(fs.stat(result.media[ASSET_A].path)).resolves.toBeTruthy();
    });

    it("never writes to the project", async () => {
        await writeLibrary("audio", { [ASSET_A]: { bytes: wavBytes() } });
        await run();
        // The master is what the author recorded; only the shipped copy is
        // compressed, and a build that quietly rewrote the library would be
        // destroying work no cache can give back.
        expect((await fs.stat(contentPath(ASSET_A))).size).toBe(wavBytes().length);
    });

    it("spawns nothing while both switches are off", async () => {
        await writeLibrary("audio", { [ASSET_A]: { bytes: wavBytes() } });
        const probe = { count: 0 };
        const encoder = fakeEncoder();
        const result = await run({
            config: DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
            probeRun: fakeProbe([{ codec_type: "audio", codec_name: "pcm_s16le" }], probe),
            encodeOptions: { spawnProcess: encoder.spawnProcess },
        });
        expect(result).toMatchObject({ converted: 0, keptOriginal: 0 });
        // Not one process and not one log line. A project that compresses nothing
        // pays nothing, and a host with no FFmpeg says nothing about a step it
        // was never asked to take - the metadata half needs no binary at all.
        expect(probe.count).toBe(0);
        expect(encoder.invocations).toHaveLength(0);
        expect(log).not.toHaveBeenCalled();
    });

    it("takes the tags off a file it is not compressing", async () => {
        // The path most of a project goes down: compression off, so every file
        // ships as the author saved it - which is exactly when the tags would
        // otherwise ship with it.
        await writeLibrary("audio", { [ASSET_A]: { bytes: taggedWav() } });
        const result = await run({ config: DEFAULT_ASSET_COMPRESSION_CONFIGURATION });
        expect(result.stripped).toBe(1);
        expect(result.metadataBytes).toBeGreaterThan(0);
        const shipped = result.media[ASSET_A];
        // The container did not change, so the manifest's own extension still
        // describes it and nothing here restates one.
        expect(shipped.ext).toBeUndefined();
        expect(shipped.mimeType).toBeUndefined();
        const bytes = await fs.readFile(shipped.path);
        expect(bytes.includes(Buffer.from("Someone Real"))).toBe(false);
        expect(bytes.length).toBeLessThan(taggedWav().length);
    });

    it("leaves an untagged file out of the table entirely", async () => {
        await writeLibrary("audio", { [ASSET_A]: { bytes: wavBytes() } });
        const result = await run({ config: DEFAULT_ASSET_COMPRESSION_CONFIGURATION });
        expect(result).toMatchObject({ stripped: 0, media: {} });
    });

    it("strips what it refused to compress", async () => {
        // A file the plan skips still ships, so it still has to be cleaned.
        await writeLibrary("audio", { [ASSET_A]: { bytes: taggedWav() } });
        const result = await run({
            probeRun: fakeProbe([]),   // no streams: nothing to re-encode
        });
        expect(result).toMatchObject({ converted: 0, stripped: 1 });
    });

    it("keeps the original when the encode is not enough smaller", async () => {
        await writeLibrary("audio", { [ASSET_A]: { bytes: wavBytes() } });
        const encoder = fakeEncoder({ ratio: 0.999 });
        const result = await run({ encodeOptions: { spawnProcess: encoder.spawnProcess } });
        expect(result).toMatchObject({ converted: 0, keptOriginal: 1, media: {} });
    });

    it("remembers a rejection, so the next build does not encode it again", async () => {
        await writeLibrary("audio", { [ASSET_A]: { bytes: wavBytes() } });
        const first = fakeEncoder({ ratio: 0.999 });
        await run({ encodeOptions: { spawnProcess: first.spawnProcess } });
        const second = fakeEncoder({ ratio: 0.999 });
        const result = await run({ encodeOptions: { spawnProcess: second.spawnProcess } });
        // Real projects contain tracks that do not compress. Without a record of
        // that, every one of them is re-encoded on every build to reach the same
        // answer.
        expect(second.invocations).toHaveLength(0);
        expect(result.keptOriginal).toBe(1);
    });

    it("reuses a kept encode without spawning anything, and without re-probing", async () => {
        await writeLibrary("audio", { [ASSET_A]: { bytes: wavBytes() } });
        await run();
        const probe = { count: 0 };
        const encoder = fakeEncoder();
        const result = await run({
            probeRun: fakeProbe([{ codec_type: "audio", codec_name: "pcm_s16le" }], probe),
            encodeOptions: { spawnProcess: encoder.spawnProcess },
        });
        expect(result).toMatchObject({ converted: 1, reused: 1 });
        expect(encoder.invocations).toHaveLength(0);
        // The probe answer is cached by the source bytes and separately from the
        // encode, which is what stops a warm build from spawning one process per
        // voice line.
        expect(probe.count).toBe(0);
    });

    it("re-encodes when the authored quality changes", async () => {
        await writeLibrary("audio", { [ASSET_A]: { bytes: wavBytes() } });
        await run();
        const encoder = fakeEncoder();
        await run({
            config: { ...AUDIO_ON, audioQuality: 30 },
            encodeOptions: { spawnProcess: encoder.spawnProcess },
        });
        expect(encoder.invocations).toHaveLength(1);
        expect(encoder.invocations[0]).toContain("-b:a");
    });

    it("carries the quality and the sample-rate cap into the arguments", async () => {
        await writeLibrary("audio", { [ASSET_A]: { bytes: wavBytes() } });
        const encoder = fakeEncoder();
        await run({
            probeRun: fakeProbe([{ codec_type: "audio", codec_name: "flac", sample_rate: "96000" }]),
            encodeOptions: { spawnProcess: encoder.spawnProcess },
        });
        const args = encoder.invocations[0];
        expect(args).toContain("aac");
        expect(args[args.indexOf("-ar") + 1]).toBe("48000");
        expect(args[args.indexOf("-f") + 1]).toBe("mp4");
        // The encoder writes to a scratch name in the destination directory and
        // the finished file is linked into place afterwards, so the argv never
        // carries the name the build will actually read.
        expect(args[args.length - 1].endsWith(".part")).toBe(true);
    });

    it("leaves a source at or below the delivery rate at the rate it has", async () => {
        await writeLibrary("audio", { [ASSET_A]: { bytes: wavBytes() } });
        const encoder = fakeEncoder();
        await run({
            probeRun: fakeProbe([{ codec_type: "audio", codec_name: "pcm_s16le", sample_rate: "44100" }]),
            encodeOptions: { spawnProcess: encoder.spawnProcess },
        });
        expect(encoder.invocations[0]).not.toContain("-ar");
    });

    it("warns once per file the encoder cannot read, and ships it unchanged", async () => {
        await writeLibrary("audio", { [ASSET_A]: { name: "Broken", bytes: wavBytes() } });
        const encoder = fakeEncoder({ fail: true });
        const result = await run({ encodeOptions: { spawnProcess: encoder.spawnProcess } });
        expect(result).toMatchObject({ converted: 0, keptOriginal: 1, media: {} });
        expect(log).toHaveBeenCalledWith("warning", expect.stringContaining("Broken"));
    });

    it("builds without a probe, says so once, and still strips", async () => {
        // A host missing the staged binaries has one thing wrong with it, not one
        // thing wrong per file in the library.
        await writeLibrary("audio", {
            [ASSET_A]: { bytes: taggedWav() },
            [ASSET_B]: { bytes: taggedWav() },
        });
        await fs.rm(path.join(binDir, "ffprobe.exe"));
        const result = await run();
        expect(log.mock.calls.filter(([level]) => level === "warning")).toHaveLength(1);
        // The metadata half needs no binary, so it runs anyway.
        expect(result.stripped).toBe(2);
    });

    it("builds without an encoder, and says so once", async () => {
        await writeLibrary("audio", {
            [ASSET_A]: { bytes: wavBytes() },
            [ASSET_B]: { bytes: wavBytes() },
        });
        await fs.rm(path.join(binDir, "ffmpeg.exe"));
        const result = await run();
        // Never fatal: this is an improvement on a build that already works.
        expect(result).toMatchObject({ converted: 0, media: {} });
        expect(log.mock.calls.filter(([level]) => level === "warning")).toHaveLength(1);
    });

    it("stops when the build is cancelled", async () => {
        await writeLibrary("audio", {
            [ASSET_A]: { bytes: wavBytes() },
            [ASSET_B]: { bytes: wavBytes() },
        });
        const encoder = fakeEncoder();
        await run({
            cancelled: () => true,
            encodeOptions: { spawnProcess: encoder.spawnProcess },
        });
        expect(encoder.invocations).toHaveLength(0);
    });
});
