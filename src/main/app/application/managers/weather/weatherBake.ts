import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { buildWeatherField, createWeatherRenderer } from "@shared/weather/field";
import { resolveWeatherParams, type WeatherBakeQuality, type WeatherBakeSpec } from "@shared/weather/model";
import { vp9Args } from "../media/mediaTranscode";

/**
 * Producing the clip a weather seed describes.
 *
 * The renderer is the one in `@shared/weather/field` — the same code the editor's preview draws
 * with, deliberately, because a preview of a different implementation is a preview of something
 * else. This module is only the plumbing around it: hand frames to ffmpeg, watch it encode, land the
 * file.
 *
 * ## Why the frames are pushed rather than the encoder pulling a file
 *
 * There is no source file. The seed IS the source, so the pipeline is `render -> stdin -> encoder`
 * and the two halves run concurrently. That concurrency is not incidental: rasterising is a small
 * fraction of a bake and encoding is the rest, so the render happens inside the encoder's own wait
 * and adding shutter samples to the picture costs no wall-clock at all.
 *
 * ## What is reported as progress
 *
 * The encoder's frame counter, not ours. Frames written to the pipe run ahead of frames encoded —
 * the OS buffer alone holds several — so reporting what we fed would show a bar that finishes early
 * and then waits, which is the specific dishonesty a progress readout exists to avoid. Completion is
 * the process exiting, never the counter reaching the total.
 */

/** The subset of a spawned process this module drives. Named here because it needs stdin. */
export type BakeStream = {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
};

export type BakeInput = {
    // Widened to the renderer's own buffer type. A `Uint8ClampedArray` is a perfectly good
    // `ArrayBufferView` for a stream, but it is not assignable to `Uint8Array` in the type system, and
    // the alternative - copying every frame into a second buffer to satisfy a signature - would be
    // eight megabytes of pointless work per frame.
    write(chunk: Uint8Array | Uint8ClampedArray): boolean;
    once(event: "drain", listener: () => void): unknown;
    on(event: "error", listener: (error: Error) => void): unknown;
    end(): unknown;
};

export type BakeChildProcess = {
    stdin: BakeInput | null;
    stdout: BakeStream | null;
    stderr: BakeStream | null;
    on(event: "error", listener: (error: Error) => void): unknown;
    on(event: "close", listener: (code: number | null, signal: string | null) => void): unknown;
    kill(signal?: string): boolean;
};

export type BakeSpawn = (binary: string, args: string[]) => BakeChildProcess;

export type WeatherBakeProgress = {
    /** Frames the encoder has taken, out of {@link WeatherBakeSpec.frames}. */
    frames: number;
    total: number;
};

export type WeatherBakeResult =
    | { status: "done"; path: string; bytes: number }
    | { status: "cancelled" }
    | { status: "error"; detail: string; stderr: string };

export type WeatherBakeHandle = {
    result: Promise<WeatherBakeResult>;
    cancel(): void;
};

/**
 * The frames of one clip, in order, however they are drawn.
 *
 * The bake pushes them into the encoder one after another; where they were DRAWN is not its
 * business. {@link serialWeatherFrames} draws each one when it is asked for, which is all a test or
 * a small clip needs; the bake worker hands in a pool that draws several at once on other threads,
 * which it can do because a frame is a pure function of its phase.
 *
 * Each call answers with a buffer the caller owns until the next one. That is not a formality: a
 * stream keeps whatever it is handed until the write completes, and the renderer overwrites its own
 * buffer on the next frame, so a sequence that handed out its working buffer would let a queued
 * frame be redrawn underneath the encoder - a corruption that only shows up on a machine that is
 * fast that day.
 */
export type WeatherFrameSequence = {
    /** The next frame, or null once the sequence is spent. Rejects if the frames cannot be drawn. */
    next(): Promise<Uint8Array | null>;
    /** Stop early and let go of whatever is drawing. Safe to call twice. */
    close(): void;
};

export type WeatherBakeOptions = {
    /**
     * How hard the encoder is asked to work. Stated by every caller, never defaulted.
     *
     * There is no sensible default: the two callers want opposite things - a build wants the file a
     * player will get, a Dev Mode session wants to stop waiting - and a default would silently give
     * one of them the other's answer. The manager writes the two tiers to different files for the
     * same reason, so a wrong answer here is a wrong file rather than a slow one.
     */
    quality: WeatherBakeQuality;
    onProgress?: (progress: WeatherBakeProgress) => void;
    /** Injected in tests; defaults to a real `child_process.spawn`. */
    spawnProcess?: BakeSpawn;
    /** Where the frames come from. Defaults to drawing them here, one at a time. */
    frameSource?: WeatherFrameSequence;
};

/** Draw every frame in this thread, one per request. The plain answer, and the fallback. */
export function serialWeatherFrames(spec: WeatherBakeSpec): WeatherFrameSequence {
    const params = resolveWeatherParams(spec.ref);
    const field = buildWeatherField(spec.ref.seed, params, spec.width, spec.height);
    const renderer = createWeatherRenderer(field, spec.width, spec.height, { frames: spec.frames });
    let index = 0;
    return {
        next: async () => {
            if (index >= spec.frames) {
                return null;
            }
            renderer.render(index / spec.frames);
            index += 1;
            return new Uint8Array(renderer.frame);
        },
        close: () => {
            index = spec.frames;
        },
    };
}

/** How long a `SIGTERM` is given before it becomes a `SIGKILL`. Matches the transcode path. */
const KILL_ESCALATION_MS = 2000;

/** The tail of stderr kept for a failure report. Enough to hold what ffmpeg says, bounded so a runaway cannot. */
const STDERR_TAIL_BYTES = 16 * 1024;

/**
 * The argv for one bake.
 *
 * Pure and exported so the arguments can be asserted without running anything — they are where this
 * is right or wrong, and a test that only checks the exit code cannot tell a correct encode from one
 * that happened to produce a file.
 *
 * `-an` because a weather overlay has no audio: leaving the encoder to decide would let a future
 * default add an empty track, and WebM's audio codec is a decision made elsewhere.
 *
 * The quality decides the encoder's speed and nothing else. Everything that makes the file playable
 * on the targets this project ships to - the codec, profile 0, the CRF - is the same in both tiers,
 * so a draft clip is a legal answer to a request for the picture; it is simply a bigger one.
 */
export function weatherBakeArgs(
    spec: WeatherBakeSpec,
    quality: WeatherBakeQuality,
    outputPath: string,
): string[] {
    return [
        "-hide_banner",
        "-nostdin",
        "-loglevel", "error",
        "-progress", "pipe:1",
        "-nostats",
        "-y",
        "-f", "rawvideo",
        // RGBA rather than RGB24 because that is the layout the shared renderer writes and a canvas
        // reads; the encoder drops the alpha on its way to yuv420p, which is correct - the clip is
        // opaque by design (WebKit discards alpha in WebM, so transparency is expressed on black).
        "-pix_fmt", "rgba",
        "-s", `${spec.width}x${spec.height}`,
        "-r", String(spec.fps),
        "-i", "pipe:0",
        ...vp9Args(quality === "draft" ? "realtime" : "good"),
        "-an",
        // Named rather than inferred: the file this writes is a `.part`, and ffmpeg picks its muxer
        // from the extension unless told. Without this it refuses the output outright - the same
        // reason every branch of the transcode path states its muxer.
        "-f", "webm",
        outputPath,
    ];
}

/** `frame=123` out of ffmpeg's `-progress` stream. Anything else in the block is not our business. */
export function parseBakeFrame(chunk: string): number | null {
    let frame: number | null = null;
    for (const line of chunk.split(/\r?\n/)) {
        const match = /^frame=(\d+)$/.exec(line.trim());
        if (match) {
            frame = Number(match[1]);
        }
    }
    return frame;
}

const realSpawn: BakeSpawn = (binary, args) =>
    spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] }) as unknown as BakeChildProcess;

/**
 * Render and encode one clip.
 *
 * Never throws: every way this can fail is a status the caller renders, exactly as the media
 * conversion path does. The file lands through a temporary name in the same directory so a killed
 * Studio leaves a `.part` behind rather than a truncated clip that the cache would then serve
 * forever as a valid answer.
 */
export function startWeatherBake(
    binaryPath: string,
    spec: WeatherBakeSpec,
    targetPath: string,
    options: WeatherBakeOptions,
): WeatherBakeHandle {
    let cancelled = false;
    let child: BakeChildProcess | null = null;
    let escalation: NodeJS.Timeout | null = null;

    const cancel = (): void => {
        cancelled = true;
        if (child) {
            child.kill("SIGTERM");
            if (escalation === null) {
                escalation = setTimeout(() => child?.kill("SIGKILL"), KILL_ESCALATION_MS);
                escalation.unref?.();
            }
        }
    };

    return { result: run(), cancel };

    async function run(): Promise<WeatherBakeResult> {
        if (cancelled) {
            return { status: "cancelled" };
        }
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        // A random temporary name in the target's own directory: landing it is then a rename within
        // one volume rather than a copy, and nothing about the name can be steered by a value that
        // came out of a document.
        const tempPath = path.join(
            path.dirname(targetPath),
            `.nls-weather-${crypto.randomBytes(8).toString("hex")}.part`,
        );

        const spawnProcess = options.spawnProcess ?? realSpawn;
        let stderrTail = "";
        let spawnError: Error | null = null;
        let pipeBroken = false;

        try {
            child = spawnProcess(binaryPath, weatherBakeArgs(spec, options.quality, tempPath));
        } catch (error) {
            return { status: "error", detail: describe(error), stderr: "" };
        }

        child.on("error", error => {
            spawnError = error;
        });
        child.stderr?.on("data", chunk => {
            stderrTail = (stderrTail + String(chunk)).slice(-STDERR_TAIL_BYTES);
        });
        child.stdout?.on("data", chunk => {
            const frame = parseBakeFrame(String(chunk));
            if (frame !== null) {
                options.onProgress?.({ frames: Math.min(frame, spec.frames), total: spec.frames });
            }
        });
        // The encoder can die at any point - a bad argument, a full disk - and the next write then
        // raises EPIPE. Without this listener that is an unhandled error event, which takes the whole
        // process down; with it, feeding stops and the close handler reports what ffmpeg said.
        child.stdin?.on("error", () => {
            pipeBroken = true;
        });

        const closed = new Promise<{ code: number | null; signal: string | null }>(resolve => {
            child?.on("close", (code, signal) => resolve({ code, signal }));
        });
        // The same close, as a bare signal the feed loop can race a stalled write against.
        const settled = closed.then(() => undefined);

        let renderError: string | null = null;
        await feed();
        const { code } = await closed;
        if (escalation) {
            clearTimeout(escalation);
        }

        if (cancelled) {
            await remove(tempPath);
            return { status: "cancelled" };
        }
        if (renderError) {
            // Checked before the exit code: an encoder fed half a clip fails with a sentence about
            // its input, which would name the wrong thing entirely.
            await remove(tempPath);
            return { status: "error", detail: renderError, stderr: stderrTail };
        }
        if (spawnError) {
            await remove(tempPath);
            return { status: "error", detail: describe(spawnError), stderr: stderrTail };
        }
        if (code !== 0) {
            await remove(tempPath);
            return {
                status: "error",
                detail: `ffmpeg exited with ${code === null ? "no code" : code}`,
                // Said outright rather than left as an empty string: an encoder that printed nothing
                // is a finding about the failure, not a gap in this report.
                stderr: stderrTail || "ffmpeg wrote nothing to stderr",
            };
        }

        try {
            const stat = await fs.stat(tempPath);
            await fs.rename(tempPath, targetPath);
            return { status: "done", path: targetPath, bytes: stat.size };
        } catch (error) {
            await remove(tempPath);
            return { status: "error", detail: describe(error), stderr: stderrTail };
        }

        /** Push every frame into the encoder, respecting its backpressure. */
        async function feed(): Promise<void> {
            const stdin = child?.stdin;
            if (!stdin) {
                return;
            }
            const frames = options.frameSource ?? serialWeatherFrames(spec);
            try {
                for (;;) {
                    if (cancelled || pipeBroken) {
                        break;
                    }
                    // Each frame is this loop's to keep until the write completes - see
                    // `WeatherFrameSequence`, which is where the copy that used to be here now lives.
                    const frame = await frames.next();
                    if (!frame) {
                        break;
                    }
                    if (!stdin.write(frame)) {
                        // Raced against the process ending: if the encoder dies while a frame is
                        // parked here, its drain never comes. Waiting on it alone is a bake that
                        // hangs forever rather than one that reports what ffmpeg said.
                        await Promise.race([drained(stdin), settled]);
                    }
                }
            } catch (error) {
                // Nothing more can be fed, and what has been fed is half a clip. Said in our own
                // words so the failure names the drawing rather than the encoder that choked on it.
                renderError = describe(error);
            } finally {
                frames.close();
                stdin.end();
            }
        }
    }
}

/** Resolve when the stream can take more. Split out so the race above reads as what it is. */
function drained(stdin: BakeInput): Promise<void> {
    return new Promise<void>(resolve => stdin.once("drain", () => resolve()));
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function remove(target: string): Promise<void> {
    await fs.rm(target, { force: true }).catch(() => undefined);
}
