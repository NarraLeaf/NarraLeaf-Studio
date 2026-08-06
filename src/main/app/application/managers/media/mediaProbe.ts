import { execFile } from "child_process";
import type { ExecFileException } from "child_process";
import type { MediaProbeOutcome } from "@shared/types/mediaProbe";
import {
    classifyMediaSupport,
    isRefusedMediaFileName,
    parseProbeOutput,
} from "@shared/utils/mediaSupport";
import { resolveFfmpegBinary, type FfmpegResolverApp, type FfmpegResolveOptions } from "./ffmpegTool";

/**
 * Ask ffprobe what is inside a media file, and turn the answer into a support verdict.
 *
 * This module owns exactly one thing: running the binary and getting a trustworthy report out of
 * it. The decision about what the report *means* is pure and lives in `@shared/utils/mediaSupport`,
 * so the tables can be read and tested by anyone without a copy of FFmpeg.
 *
 * Nothing here writes a file, converts anything, or touches the asset library. M2 is what wires
 * this into import; until then it is a service with an IPC seam and no callers in the product path.
 */

export type { MediaProbeFailureReason, MediaProbeOutcome } from "@shared/types/mediaProbe";

/**
 * ffprobe on a local file answers in milliseconds; anything approaching this bound means it is
 * stuck, not slow. Generous rather than tight because the file may be on a network share or a
 * sleeping external disk, where the first read can take seconds.
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 15_000;

/**
 * A `-show_streams` report is a few kilobytes. The cap is not a performance measure — it is a
 * guard against a pathological file producing output large enough to matter, since the buffer is
 * held in the main process.
 */
const MAX_PROBE_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * `-v quiet` keeps diagnostics off stdout so the JSON is the only thing there, and the JSON is the
 * only contract this module depends on. `-show_format` carries `format_name`; `-show_streams`
 * carries `codec_type`, `codec_name` and the `disposition` bag the cover-art guard reads.
 *
 * The path goes last and is passed as an argv element, never through a shell: file names contain
 * quotes, spaces and semicolons, and an author's file name must never be able to become a command.
 */
function probeArgs(filePath: string): string[] {
    return ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath];
}

export type ProbeRunner = (
    binary: string,
    args: string[],
    timeoutMs: number,
) => Promise<{ stdout: string; timedOut: boolean; error: ExecFileException | null }>;

/**
 * Whether an `execFile` error is Node's own timeout, as opposed to the child exiting badly.
 *
 * The distinction is finer than it looks, and getting it wrong is not cosmetic — it turns every
 * unreadable file into "ffprobe did not answer within 15000ms", a message that is both wrong and
 * unactionable. Two traps, both found by running the real binary:
 *
 *  1. **`signal` is `null`, not `undefined`, on an ordinary non-zero exit.** A `!== undefined`
 *     test therefore reports *every* failed probe as a timeout, and a hand-built mock that simply
 *     omits the field will never show it.
 *  2. **`killed` is also true when the output cap is hit**, which is not a timeout either. That
 *     case is left to fall through to the parse step, where truncated JSON correctly surfaces as
 *     malformed output rather than as a stall.
 */
export function isTimeout(error: ExecFileException | null): boolean {
    if (!error) {
        return false;
    }
    if ((error as { code?: unknown }).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        return false;
    }
    return error.killed === true || typeof error.signal === "string";
}

/**
 * Run the binary and hand back everything the caller needs to tell the arms apart.
 *
 * Deliberately does not reject on a non-zero exit. ffprobe exits 1 for every kind of "cannot read
 * this", *and still prints a JSON object* — an empty `{}`. Treating the exit code as fatal before
 * looking at stdout would collapse "not a media file" and "ffprobe crashed" into one message.
 */
const execProbe: ProbeRunner = (binary, args, timeoutMs) =>
    new Promise(resolve => {
        execFile(
            binary,
            args,
            { timeout: timeoutMs, maxBuffer: MAX_PROBE_OUTPUT_BYTES, windowsHide: true },
            (error, stdout) => {
                resolve({ stdout, timedOut: isTimeout(error), error: error ?? null });
            },
        );
    });

export type MediaProbeOptions = FfmpegResolveOptions & {
    timeoutMs?: number;
    /** Injected in tests; defaults to running the resolved ffprobe. */
    run?: ProbeRunner;
};

/**
 * Probe one file and classify it.
 *
 * Never throws. Every way this can go wrong is a value in {@link MediaProbeOutcome}, because the
 * caller is an import flow with a dialog open: it needs an answer for every file it was handed,
 * including the ones that are nonsense.
 */
export async function probeMediaFile(
    app: FfmpegResolverApp,
    filePath: string,
    options: MediaProbeOptions = {},
): Promise<MediaProbeOutcome> {
    // Refuse playlists, DRM wrappers and MIDI before spawning anything. Not an optimisation: FFmpeg
    // resolves the entries inside a playlist, and an entry can be an http:// URL, so probing an
    // author-supplied .m3u8 would let a file the author did not write make the main process fetch
    // something. Deciding by name means that path never exists.
    if (isRefusedMediaFileName(filePath)) {
        return { status: "probed", verdict: classifyMediaSupport({}, filePath) };
    }

    const tool = await resolveFfmpegBinary(app, "ffprobe", options);
    if (!tool.available) {
        return { status: "unavailable", detail: tool.detail, searched: tool.searched };
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    const run = options.run ?? execProbe;

    let result: Awaited<ReturnType<ProbeRunner>>;
    try {
        result = await run(tool.path, probeArgs(filePath), timeoutMs);
    } catch (error: unknown) {
        // Only a runner that rejects lands here — the default one resolves for every process
        // outcome, so this is the "could not start the process at all" arm.
        return {
            status: "failed",
            reason: "spawn-failed",
            detail: error instanceof Error ? error.message : String(error),
        };
    }

    if (result.timedOut) {
        return {
            status: "failed",
            reason: "timeout",
            detail: `ffprobe did not answer within ${timeoutMs}ms for ${filePath}`,
        };
    }

    const report = parseProbeOutput(result.stdout);
    if (report === null) {
        // Output that is not JSON at all. A non-zero exit alongside it is a symptom, not the
        // diagnosis, so the reason names what actually blocks a verdict.
        if (result.error && result.stdout.trim().length === 0) {
            return {
                status: "failed",
                reason: "exited",
                detail: `ffprobe exited without output for ${filePath}: ${result.error.message}`,
            };
        }
        return {
            status: "failed",
            reason: "malformed-output",
            detail: `ffprobe produced output that is not JSON for ${filePath}`,
        };
    }

    // Parsed JSON, whatever the exit code. ffprobe's failure output is the empty object `{}`, which
    // classifies as `refuse`/`no-streams` — the honest verdict for a file nothing can read, and a
    // better thing to show an author than an exit code.
    return { status: "probed", verdict: classifyMediaSupport(report, filePath) };
}
