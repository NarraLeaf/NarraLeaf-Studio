import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import type {
    MediaConvertFailureReason,
    MediaConvertProgress,
    MediaConvertRequest,
    MediaConvertTarget,
} from "@shared/types/mediaConvert";

/**
 * Running ffmpeg: the half that acts, next to `mediaProbe.ts`, the half that asks.
 *
 * Three jobs, deliberately separable so two of them can be tested without a binary:
 *
 *   - {@link transcodeArgs} turns a target into an argv. Pure.
 *   - {@link createProgressParser} turns ffmpeg's progress stream into percentages. Pure.
 *   - {@link startMediaTranscode} spawns, streams, cancels, and lands the file. Not pure, and
 *     injectable, so its failure arms are testable too.
 *
 * ## Two rules that are not negotiable
 *
 * **The source is never written to.** Output goes to a temporary file in the *target's* directory
 * and is moved into place only after ffmpeg exits zero. A cancelled or failed conversion leaves
 * nothing behind: a half-written file that survived would be indistinguishable from a finished one
 * to whatever runs next, and the next thing here is an asset import.
 *
 * **Nothing is overwritten.** An occupied target path is an error before anything spawns, and the
 * move at the end is done with a link (which fails if the name is taken) rather than a rename
 * (which does not).
 */

/* -------------------------------------------------------------------------------------------- */
/* Argument assembly                                                                              */
/* -------------------------------------------------------------------------------------------- */

/**
 * Muxer names, which are not container names.
 *
 * `-f` takes the *muxer*, and the two agree for every row here but one: ADTS AAC is demuxed by
 * `aac` and muxed by `adts`, so `-f aac` is not a thing and fails at startup. That single row is
 * the reason this map exists rather than an interpolation of the container name.
 */
const MUXER_FOR_CONTAINER: Readonly<Record<string, string>> = {
    webm: "webm",
    mp4: "mp4",
    ogg: "ogg",
    mp3: "mp3",
    flac: "flac",
    wav: "wav",
    aac: "adts",
    png: "image2",
};

/**
 * Options that apply to every invocation.
 *
 * `-nostdin` matters more than it looks: without it ffmpeg puts the terminal in raw mode and reads
 * keystrokes from a stdin it shares with the Electron main process. `-loglevel error` is what makes
 * the stderr tail worth showing an author — at the default level the last ten lines are the encoder
 * bragging about its bitrate, and the actual failure has scrolled off.
 *
 * `-y` is safe here specifically because the output path is a private temporary name this module
 * generated a moment ago; the author's target is never an ffmpeg argument.
 */
const GLOBAL_ARGS: readonly string[] = [
    "-hide_banner",
    "-nostdin",
    "-loglevel", "error",
    "-progress", "pipe:1",
    "-nostats",
    "-y",
];

/**
 * VP9, in constant-quality mode.
 *
 * `-b:v 0` is not redundant next to `-crf`: without it libvpx-vp9 runs in *constrained* quality and
 * treats the (defaulted) bitrate as a cap, which quietly produces a much worse file than the CRF
 * asked for. The pairing is the documented way to get constant quality out of libvpx and the single
 * easiest thing to get wrong here.
 *
 * `-pix_fmt yuv420p` forces VP9 profile 0. Sources that arrive on this path are frequently 10-bit
 * (HEVC from a phone) or 4:2:2 (ProRes from an editor), and encoding those as VP9 profile 2 or 1
 * produces a file Chromium may decode on the developer's desktop and a player's device may not.
 * Profile 0 is the one every VP9 decoder is required to have.
 */
const VP9_ARGS: readonly string[] = [
    "-c:v", "libvpx-vp9",
    "-b:v", "0",
    "-crf", "32",
    "-row-mt", "1",
    "-deadline", "good",
    "-cpu-used", "2",
    "-pix_fmt", "yuv420p",
];

/** Vorbis, at libvorbis's quality scale. Used only alongside VP9, because WebM cannot carry AAC. */
const VORBIS_ARGS: readonly string[] = ["-c:a", "libvorbis", "-q:a", "5"];

/**
 * AAC, from libavcodec's own encoder.
 *
 * Not `libfdk_aac`, which is the nonfree one and is disabled in the build that ships. A bitrate
 * rather than `-q:a`: the native encoder's VBR mode is still marked experimental and its quality
 * scale has changed between releases, while 192k stereo is stable and roughly transparent for the
 * voice and music an author imports.
 */
const AAC_ARGS: readonly string[] = ["-c:a", "aac", "-b:a", "192k"];

/**
 * The argv for one conversion, excluding the binary itself.
 *
 * Pure and exported so the three shapes can be asserted without a process — the arguments are where
 * this feature is wrong or right, and a test that only checks the exit code cannot see the
 * difference between a lossless remux and a re-encode that happened to succeed.
 */
export function transcodeArgs(target: MediaConvertTarget, sourcePath: string, outputPath: string): string[] {
    const args = [...GLOBAL_ARGS, "-i", sourcePath];

    if (target.kind === "image") {
        // One frame, PNG, and no quality knob of any kind. A multi-page TIFF yields its first page.
        //
        // `-update 1` is required rather than tidy: the image2 muxer reads `%d` and friends in the
        // output name as a frame-number pattern, and `update` is the documented switch that makes it
        // treat the name as a literal. The temporary name this module generates has no `%` in it, so
        // nothing depends on that today - which is exactly the kind of accident that stops being
        // true when someone changes how the temporary file is named.
        args.push("-map", "0:v:0", "-frames:v", "1", "-c:v", "png", "-update", "1");
        args.push("-f", MUXER_FOR_CONTAINER[target.container], outputPath);
        return args;
    }

    if (target.kind === "remux") {
        // `0:V` (capital) is video *excluding attached pictures*, which is the same exclusion the
        // classifier makes when it decides whether a file has video at all. With `0:v` an MP3's
        // album art would be mapped into a WAV and the command would fail on a file the verdict
        // called losslessly convertible. The `?` suffixes make each mapping optional, so an
        // audio-only source does not fail for having no video track.
        //
        // Subtitle and data streams are deliberately not mapped: they may be illegal in the
        // destination container, and the engine never asks a decoder for them.
        args.push("-map", "0:V?", "-map", "0:a?", "-c", "copy");
        args.push(...containerFlags(target.container));
        args.push("-f", MUXER_FOR_CONTAINER[target.container], outputPath);
        return args;
    }

    // Re-encode. Each side is configured only when the classifier said the source has that kind of
    // stream, so a `null` side contributes neither a mapping nor an encoder. That is why there is no
    // `-vn`/`-an` anywhere in this file: "do not encode video" and "there is no video" are different
    // statements, and the second one needs no flag at all.
    if (target.video !== null) {
        args.push("-map", "0:V?", ...VP9_ARGS);
    }
    if (target.audio !== null) {
        args.push("-map", "0:a?", ...(target.audio === "aac" ? AAC_ARGS : VORBIS_ARGS));
    }
    args.push(...containerFlags(target.container));
    args.push("-f", MUXER_FOR_CONTAINER[target.container], outputPath);
    return args;
}

/**
 * Per-container extras.
 *
 * Only MP4 has any: `+faststart` moves the index to the front of the file in a second pass, which
 * is what lets a web export begin playing before the whole file has arrived. Without it a browser
 * fetching over HTTP must download to the end before it can start, and that is precisely the
 * deployment the audio-only target exists to serve.
 */
function containerFlags(container: string): string[] {
    return container === "mp4" ? ["-movflags", "+faststart"] : [];
}

/* -------------------------------------------------------------------------------------------- */
/* Progress                                                                                       */
/* -------------------------------------------------------------------------------------------- */

export type ProgressParser = {
    /** Feed a chunk of ffmpeg's stdout. Returns one entry per completed progress block. */
    push(chunk: string): MediaConvertProgress[];
};

/** `HH:MM:SS.ffffff` as ffmpeg prints `out_time`. */
const OUT_TIME_PATTERN = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/;

/**
 * Read ffmpeg's `-progress` stream.
 *
 * That stream is used instead of parsing stderr because stderr is a status *line* rewritten in
 * place with carriage returns, interleaved with warnings, and formatted for a human; `-progress`
 * is `key=value` newline-delimited and is the only output ffmpeg documents as machine-readable.
 * A block ends with a `progress=continue` or `progress=end` line, which is what makes it safe to
 * emit only whole blocks: the fields arrive one per line, so a chunk boundary can otherwise land
 * between a time and the block it belongs to.
 *
 * Chunks are reassembled across `push` calls, because a pipe splits wherever it likes and a 4096th
 * byte in the middle of `out_time_us=` is a routine occurrence rather than a corner case.
 */
export function createProgressParser(durationUs: number | null): ProgressParser {
    let buffer = "";
    let outTimeUs: number | null = null;

    return {
        push(chunk: string): MediaConvertProgress[] {
            buffer += chunk;
            const lines = buffer.split("\n");
            // Whatever follows the last newline is an unfinished line; keep it for the next chunk.
            buffer = lines.pop() ?? "";

            const emitted: MediaConvertProgress[] = [];
            for (const raw of lines) {
                const line = raw.trim();
                const separator = line.indexOf("=");
                if (separator <= 0) {
                    continue;
                }
                const key = line.slice(0, separator);
                const value = line.slice(separator + 1).trim();

                if (key === "out_time_us") {
                    const parsed = Number.parseInt(value, 10);
                    // "N/A" before the first frame, and a large negative sentinel when ffmpeg has
                    // opened the output but written nothing. Neither is a position; keep the last
                    // real one rather than reporting a jump backwards to zero.
                    if (Number.isFinite(parsed) && parsed >= 0) {
                        outTimeUs = parsed;
                    }
                    continue;
                }
                if (key === "out_time" && outTimeUs === null) {
                    // Fallback for the same value in clock form. Read only while `out_time_us` has
                    // never been usable, so the two can never disagree.
                    const clock = parseOutTime(value);
                    if (clock !== null) {
                        outTimeUs = clock;
                    }
                    continue;
                }
                if (key === "progress") {
                    emitted.push(progressOf(outTimeUs, durationUs));
                }
            }
            return emitted;
        },
    };
}

function parseOutTime(value: string): number | null {
    const match = OUT_TIME_PATTERN.exec(value);
    if (!match) {
        return null;
    }
    const fraction = match[4] ? Number.parseFloat(`0.${match[4]}`) : 0;
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + fraction;
    return Math.round(seconds * 1_000_000);
}

/**
 * One progress record.
 *
 * `fraction` stays `null` unless *both* numbers are real. An unknown duration is the normal case for
 * an image conversion and a possible one for a live-muxed source, and the alternative to `null` is
 * a bar that is lying about something the caller cannot check.
 */
function progressOf(outTimeUs: number | null, durationUs: number | null): MediaConvertProgress {
    if (durationUs === null || durationUs <= 0 || outTimeUs === null) {
        return { outTimeUs, durationUs, fraction: null };
    }
    return {
        outTimeUs,
        durationUs,
        // Clamped: ffmpeg routinely reports a few frames past a container's declared duration, and
        // a bar that reads 103% is a bug report.
        fraction: Math.min(1, Math.max(0, outTimeUs / durationUs)),
    };
}

/* -------------------------------------------------------------------------------------------- */
/* Running                                                                                        */
/* -------------------------------------------------------------------------------------------- */

/** Lines of stderr kept for the failure message. */
const STDERR_TAIL_LINES = 8;
/** Ceiling on the retained stderr, so a pathological file cannot grow the buffer without bound. */
const STDERR_TAIL_BYTES = 16 * 1024;
/** How long a killed ffmpeg gets to exit before the signal is escalated. */
const KILL_ESCALATION_MS = 5_000;

export type MediaTranscodeResult =
    | { status: "done"; outputPath: string }
    | { status: "cancelled" }
    | {
        status: "error";
        reason: MediaConvertFailureReason;
        /** One line, for a caller that has to put a failure in front of an author. */
        detail: string;
        /**
         * Everything ffmpeg wrote to stderr, up to {@link STDERR_TAIL_BYTES}, verbatim.
         *
         * Separate from `detail` because the two have different readers. `detail` is an author's
         * sentence and is deliberately short; this is the encoder's own words - line numbers,
         * stream indices, the codec it could not open - and is the only thing that makes a failed
         * conversion diagnosable after the fact. `MediaConvertManager` writes it to the log file
         * and nothing puts it on screen: see docs/help-system.md on why a stderr tail in a list
         * row's tooltip was the wrong home for it.
         *
         * Empty when no process ever ran, which is a fact rather than a gap.
         */
        stderr: string;
    };

/** The failure arm, named so a helper can promise it rather than the whole union. */
export type MediaTranscodeError = Extract<MediaTranscodeResult, { status: "error" }>;

export type MediaTranscodeHandle = {
    result: Promise<MediaTranscodeResult>;
    /** Stop the conversion and remove the partial file. Safe to call at any point, including twice. */
    cancel(): void;
};

/** The parts of a spawned process this module uses. Narrow on purpose, so a test can supply one. */
export type TranscodeStream = {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
};

export type TranscodeChildProcess = {
    stdout: TranscodeStream | null;
    stderr: TranscodeStream | null;
    on(event: "error", listener: (error: Error) => void): unknown;
    on(event: "close", listener: (code: number | null, signal: string | null) => void): unknown;
    kill(signal?: string): boolean;
};

export type TranscodeSpawn = (binary: string, args: string[]) => TranscodeChildProcess;

/**
 * The real spawn.
 *
 * `stdio` closes stdin rather than inheriting it, which pairs with `-nostdin`: an ffmpeg holding the
 * main process's stdin is the classic way a background conversion ends up eating keystrokes.
 *
 * The cast is at this one seam. `ChildProcess` satisfies the shape above, but its `on` carries
 * dozens of overloads and matching them structurally is noise; naming the narrow type is what makes
 * everything below testable, so the assertion is paid once, here.
 */
const nodeSpawn: TranscodeSpawn = (binary, args) =>
    spawn(binary, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
    }) as unknown as TranscodeChildProcess;

export type MediaTranscodeOptions = {
    onProgress?: (progress: MediaConvertProgress) => void;
    /** Injected in tests; defaults to a real `child_process.spawn`. */
    spawnProcess?: TranscodeSpawn;
};

/**
 * Convert one file.
 *
 * Returns synchronously with a handle, before the pre-flight checks have run, so that a caller can
 * cancel a conversion it started a millisecond ago. Cancelling during the checks means no process is
 * ever spawned.
 *
 * **There is no timeout.** A two-hour re-encode of an hour of 4K is a correct outcome, and any wall
 * clock long enough not to kill that one is too long to be a useful safety net for a stuck one. What
 * makes a stuck conversion recoverable is cancellation, which is a control the author has.
 */
export function startMediaTranscode(
    binaryPath: string,
    request: MediaConvertRequest,
    options: MediaTranscodeOptions = {},
): MediaTranscodeHandle {
    let cancelled = false;
    let child: TranscodeChildProcess | null = null;
    let escalation: NodeJS.Timeout | null = null;

    const cancel = (): void => {
        cancelled = true;
        if (child) {
            child.kill("SIGTERM");
            if (escalation === null) {
                // ffmpeg exits promptly on SIGTERM, and on Windows `kill` terminates outright, so
                // this never fires in practice. It exists so that a build of ffmpeg that ignored the
                // signal could not leave a conversion that says "cancelled" while the process keeps
                // writing. `unref` so a pending escalation cannot hold the app open.
                escalation = setTimeout(() => child?.kill("SIGKILL"), KILL_ESCALATION_MS);
                escalation.unref?.();
            }
        }
    };

    const result = run();
    return { result, cancel };

    async function run(): Promise<MediaTranscodeResult> {
        const sourceCheck = await checkSource(request.sourcePath);
        if (sourceCheck) {
            return sourceCheck;
        }
        if (await exists(request.targetPath)) {
            // Refused rather than overwritten, and refused *before* the work rather than after it.
            // The caller picks the name; silently replacing whatever is there would destroy a file
            // no one in this stack knows anything about.
            return {
                status: "error",
                reason: "target-exists",
                detail: `${request.targetPath} already exists`,
                stderr: "",
            };
        }
        if (cancelled) {
            return { status: "cancelled" };
        }

        // Same directory as the target, so landing it at the end is a directory-entry operation
        // rather than a copy across volumes. The name is random rather than derived from the
        // author's: a `%` in a file name is a frame-number pattern to the image muxer, and a
        // conversion must not be able to be steered by what a file is called.
        const tempPath = path.join(
            path.dirname(request.targetPath),
            `.nls-convert-${crypto.randomBytes(8).toString("hex")}.part`,
        );

        const args = transcodeArgs(request.target, request.sourcePath, tempPath);
        // A still image has no duration, so it never gets a percentage - regardless of what the
        // probe may have said. ffprobe reports a nominal fraction of a second for a single-frame
        // input, and dividing by that would produce a bar that jumps to 100% and waits.
        const durationUs = request.target.kind === "image" ? null : request.durationUs;
        const parser = createProgressParser(durationUs);

        const exit = await new Promise<{ code: number | null; signal: string | null; error: Error | null; stderr: string }>(
            resolve => {
                let stderr = "";
                let spawnError: Error | null = null;
                try {
                    child = (options.spawnProcess ?? nodeSpawn)(binaryPath, args);
                } catch (error: unknown) {
                    // A synchronous throw from spawn - ENOENT on some platforms, EACCES on others.
                    resolve({
                        code: null,
                        signal: null,
                        error: error instanceof Error ? error : new Error(String(error)),
                        stderr: "",
                    });
                    return;
                }

                child.stdout?.on("data", chunk => {
                    for (const progress of parser.push(String(chunk))) {
                        options.onProgress?.(progress);
                    }
                });
                child.stderr?.on("data", chunk => {
                    stderr = (stderr + String(chunk)).slice(-STDERR_TAIL_BYTES);
                });
                child.on("error", error => {
                    // Recorded, not resolved: `close` still fires, and resolving here would race it
                    // and leave the stdio handles open while the temporary file is deleted.
                    spawnError = error;
                });
                child.on("close", (code, signal) => {
                    resolve({ code, signal, error: spawnError, stderr });
                });

                // Cancelled between the check above and the spawn completing.
                if (cancelled) {
                    cancel();
                }
            },
        );

        if (escalation) {
            clearTimeout(escalation);
            escalation = null;
        }
        child = null;

        if (cancelled) {
            await remove(tempPath);
            return { status: "cancelled" };
        }
        if (exit.error) {
            await remove(tempPath);
            return {
                status: "error",
                reason: "spawn-failed",
                detail: exit.error.message,
                stderr: exit.stderr,
            };
        }
        if (exit.code !== 0) {
            await remove(tempPath);
            // The source can disappear while ffmpeg is reading it; that is a different sentence to
            // show an author than "the encoder failed", and it is the one thing they can fix.
            const missing = await checkSource(request.sourcePath);
            if (missing) {
                // ffmpeg did run and did complain, even though the sentence the author gets is
                // about the file rather than the encoder. Carrying its output means the log still
                // says which of the two happened first.
                return { ...missing, stderr: exit.stderr };
            }
            return {
                status: "error",
                reason: "exited",
                detail: `ffmpeg exited with ${exit.signal ?? exit.code}: ${tailOf(exit.stderr)}`,
                stderr: exit.stderr,
            };
        }

        try {
            await land(tempPath, request.targetPath);
        } catch (error: unknown) {
            await remove(tempPath);
            const code = (error as { code?: string } | null)?.code;
            return {
                status: "error",
                reason: code === "EEXIST" ? "target-exists" : "write-failed",
                detail: error instanceof Error ? error.message : String(error),
                // ffmpeg exited zero; whatever it said on the way is not why this failed.
                stderr: "",
            };
        }
        return { status: "done", outputPath: request.targetPath };
    }
}

/** `null` when the source is a readable file, an error result when it is not. */
async function checkSource(sourcePath: string): Promise<MediaTranscodeError | null> {
    try {
        if ((await fs.stat(sourcePath)).isFile()) {
            return null;
        }
        return {
            status: "error",
            reason: "source-missing",
            detail: `${sourcePath} is not a file`,
            stderr: "",
        };
    } catch (error: unknown) {
        return {
            status: "error",
            reason: "source-missing",
            detail: error instanceof Error ? error.message : String(error),
            stderr: "",
        };
    }
}

async function exists(candidate: string): Promise<boolean> {
    try {
        await fs.stat(candidate);
        return true;
    } catch {
        return false;
    }
}

/** Best-effort deletion. A conversion that already failed must not fail again over its own scratch file. */
async function remove(candidate: string): Promise<void> {
    await fs.rm(candidate, { force: true }).catch(() => undefined);
}

/**
 * Move the finished file to its final name without being able to overwrite anything.
 *
 * `link` is the whole point: it fails with `EEXIST` if the name was taken between the check at the
 * start and now, which `rename` would not - it would replace the file silently. The fallback is for
 * filesystems with no hard links (FAT, some network shares), where a check-then-rename is the best
 * available and the window is a few milliseconds wide.
 */
async function land(tempPath: string, targetPath: string): Promise<void> {
    try {
        await fs.link(tempPath, targetPath);
        await fs.unlink(tempPath);
        return;
    } catch (error: unknown) {
        if ((error as { code?: string } | null)?.code === "EEXIST") {
            throw error;
        }
    }
    if (await exists(targetPath)) {
        throw Object.assign(new Error(`${targetPath} already exists`), { code: "EEXIST" });
    }
    await fs.rename(tempPath, targetPath);
}

/** The last few lines of stderr, which is where ffmpeg says what actually went wrong. */
function tailOf(stderr: string): string {
    const lines = stderr.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    return lines.slice(-STDERR_TAIL_LINES).join("; ") || "no diagnostic output";
}
