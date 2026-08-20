import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { buildWeatherField, createWeatherRenderer } from "@shared/weather/field";
import { resolveWeatherParams, type WeatherBakeSpec } from "@shared/weather/model";
import { VP9_ARGS } from "../media/mediaTranscode";

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

export type WeatherBakeOptions = {
    onProgress?: (progress: WeatherBakeProgress) => void;
    /** Injected in tests; defaults to a real `child_process.spawn`. */
    spawnProcess?: BakeSpawn;
};

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
 */
export function weatherBakeArgs(spec: WeatherBakeSpec, outputPath: string): string[] {
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
        ...VP9_ARGS,
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
    options: WeatherBakeOptions = {},
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
            child = spawnProcess(binaryPath, weatherBakeArgs(spec, tempPath));
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

        await feed();
        const { code } = await closed;
        if (escalation) {
            clearTimeout(escalation);
        }

        if (cancelled) {
            await remove(tempPath);
            return { status: "cancelled" };
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
            const params = resolveWeatherParams(spec.ref);
            const field = buildWeatherField(spec.ref.seed, params, spec.width, spec.height);
            const renderer = createWeatherRenderer(field, spec.width, spec.height, { frames: spec.frames });
            for (let index = 0; index < spec.frames; index++) {
                if (cancelled || pipeBroken) {
                    break;
                }
                renderer.render(index / spec.frames);
                // A COPY, not the renderer's own buffer. A stream keeps whatever it is handed until
                // the write completes, and the renderer overwrites its buffer on the next frame - so
                // passing it directly means a queued frame can be rewritten underneath the encoder.
                // In practice a frame is far larger than the pipe's watermark and every write parks
                // on drain, which is exactly what makes the bug the kind that appears once, on a
                // machine that is fast that day.
                if (!stdin.write(Buffer.from(renderer.frame))) {
                    // Raced against the process ending: if the encoder dies while a frame is parked
                    // here, its drain never comes. Waiting on it alone is a bake that hangs forever
                    // rather than one that reports what ffmpeg said.
                    await Promise.race([drained(stdin), settled]);
                }
            }
            stdin.end();
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
