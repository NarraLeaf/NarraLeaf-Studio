import crypto from "crypto";
import type {
    MediaConvertRequest,
    MediaConvertStateSnapshot,
} from "@shared/types/mediaConvert";
import { Logger } from "@shared/utils/logger";
import { resolveFfmpegBinary, type FfmpegResolveOptions, type FfmpegResolverApp } from "./ffmpegTool";
import { startMediaTranscode, type MediaTranscodeError, type MediaTranscodeOptions } from "./mediaTranscode";

/**
 * Conversions in flight, and what to tell a renderer that asks about one.
 *
 * The shape is `GameBuildManager`'s, on purpose: a `start` that returns immediately with a snapshot,
 * a `cancel`, and a `getStatus` the renderer polls. That is the app's one idiom for a long task that
 * can fail and can be stopped, and it earns its place here for the same reasons it did there - the
 * work outlives any single render, a reloading window has to be able to find the job again, and a
 * renderer that stops listening cannot leave main pushing into nothing.
 *
 * The difference is the key. A build is keyed by project because there is one build per project; a
 * conversion is keyed by an opaque job id because an author importing a folder of video has several
 * at once, and "the conversion for this project" would be a meaningless handle.
 *
 * ## Where a failed conversion goes to be diagnosed
 *
 * The snapshot a renderer polls carries one sentence, and that is all the UI shows. It is not enough
 * to work out *why* ffmpeg refused a file: the answer to that is in the encoder's own stderr, which
 * is a wall of stream indices and codec names.
 *
 * That wall does not belong on screen - it is internal vocabulary, and a long block of it stacked
 * into a list row is the shape docs/help-system.md rules out. It belongs in the log file, which
 * already exists for exactly this (`logging/fileLogSink.ts` writes every line here to
 * `<userData>/logs/main.log` and keeps five generations). So this class logs, and the dialogs stay
 * as they are. An author who reports "the conversion failed" can be asked for that file, and the
 * failure is answerable afterwards rather than only while it is on screen.
 */

const logger = new Logger("MediaConvert");

/**
 * How long a finished job stays answerable.
 *
 * Long enough that a renderer polling on a normal interval - or one that was reloading when the
 * conversion finished - still sees `done` and the output path, rather than the `idle` that means
 * "no such job". Bounded because the map is keyed by job id and would otherwise grow for the
 * lifetime of the process, one entry per file an author ever converts.
 */
const FINISHED_JOB_RETENTION_MS = 10 * 60_000;

type ConvertJob = {
    snapshot: MediaConvertStateSnapshot;
    cancel: () => void;
};

export type MediaConvertManagerOptions = FfmpegResolveOptions & Pick<MediaTranscodeOptions, "spawnProcess">;

export class MediaConvertManager {
    private readonly jobs = new Map<string, ConvertJob>();

    constructor(private readonly app: FfmpegResolverApp) {}

    /**
     * Begin a conversion and return its opening snapshot.
     *
     * Resolves the binary first, so a host with no staged ffmpeg answers `unavailable` immediately
     * rather than starting a job that fails a moment later. That distinction is the caller's whole
     * basis for saying "conversion is not available here" instead of "this file is broken".
     *
     * Never throws: like the probe, this is called with a dialog open, and every way it can go wrong
     * has to be a status the dialog can render.
     */
    public async start(
        request: MediaConvertRequest,
        options: MediaConvertManagerOptions = {},
    ): Promise<MediaConvertStateSnapshot> {
        const jobId = crypto.randomUUID();
        const tool = await resolveFfmpegBinary(this.app, "ffmpeg", options);
        if (!tool.available) {
            logger.warn(
                `No ffmpeg on this host, so ${request.sourcePath} was not converted: ${tool.detail}`,
            );
            // Recorded like any other job so a caller that polls before reading the return value
            // gets the same answer twice, rather than `idle` for a job it was just handed.
            return this.record(jobId, {
                jobId,
                status: "unavailable",
                finishedAt: Date.now(),
                error: tool.detail,
            }, () => undefined);
        }

        const startedAt = Date.now();
        const handle = startMediaTranscode(tool.path, request, {
            spawnProcess: options.spawnProcess,
            onProgress: progress => {
                const job = this.jobs.get(jobId);
                // Progress after the job has stopped is dropped rather than resurrecting it: the
                // stdout pipe can deliver a buffered block after the process has already closed.
                if (job && job.snapshot.status === "converting") {
                    job.snapshot = { ...job.snapshot, progress };
                }
            },
        });

        this.record(jobId, { jobId, status: "converting", startedAt }, handle.cancel);

        void handle.result.then(result => {
            const job = this.jobs.get(jobId);
            if (!job) {
                return;
            }
            const finishedAt = Date.now();
            if (result.status === "done") {
                logger.info(
                    `Converted ${request.sourcePath} to ${result.outputPath} in `
                    + `${finishedAt - startedAt}ms (${describeTarget(request)})`,
                );
                job.snapshot = {
                    ...job.snapshot,
                    status: "done",
                    finishedAt,
                    outputPath: result.outputPath,
                };
            } else if (result.status === "cancelled") {
                job.snapshot = { ...job.snapshot, status: "cancelled", finishedAt };
            } else {
                logger.error(failureReport(request, result));
                job.snapshot = {
                    ...job.snapshot,
                    status: "error",
                    finishedAt,
                    reason: result.reason,
                    error: result.detail,
                };
            }
            this.retire(jobId);
        });

        return this.getStatus(jobId);
    }

    /**
     * Stop a conversion.
     *
     * Returns the snapshot as it stands, which is still `converting`: the job is not cancelled until
     * the process is gone and its partial file has been removed, and saying so early would let a
     * caller start a second conversion onto the same target while the first one is still writing.
     * The next poll carries `cancelled`.
     */
    public cancel(jobId: string): MediaConvertStateSnapshot {
        const job = this.jobs.get(jobId);
        if (!job) {
            return { jobId, status: "idle" };
        }
        if (job.snapshot.status === "converting") {
            job.cancel();
        }
        return job.snapshot;
    }

    public getStatus(jobId: string): MediaConvertStateSnapshot {
        return this.jobs.get(jobId)?.snapshot ?? { jobId, status: "idle" };
    }

    private record(
        jobId: string,
        snapshot: MediaConvertStateSnapshot,
        cancel: () => void,
    ): MediaConvertStateSnapshot {
        this.jobs.set(jobId, { snapshot, cancel });
        if (snapshot.status !== "converting") {
            this.retire(jobId);
        }
        return snapshot;
    }

    /** Forget a finished job after the retention window. `unref` so it cannot hold the app open. */
    private retire(jobId: string): void {
        const timer = setTimeout(() => this.jobs.delete(jobId), FINISHED_JOB_RETENTION_MS);
        timer.unref?.();
    }
}

/**
 * What was asked for, in one line.
 *
 * The target is logged rather than the argv because `transcodeArgs` is pure and total on it: the
 * target *is* the command, and reproducing it needs no second copy of the argument assembly here to
 * drift out of step with the one that ran.
 */
function describeTarget(request: MediaConvertRequest): string {
    const target = request.target;
    if (target.kind === "image") {
        return `image -> ${target.container}`;
    }
    if (target.kind === "remux") {
        return `remux -> ${target.container}${target.audioOnly ? " (audio only)" : ""}`;
    }
    return `reencode -> ${target.container} `
        + `(video ${target.video ?? "none"}, audio ${target.audio ?? "none"})`;
}

/**
 * The whole of what is known about a failed conversion, as one log entry.
 *
 * One entry rather than several lines through the logger: the sink writes a timestamp and a level
 * per call, and a failure split across six of them is six things to correlate when two conversions
 * were running at once - which is the normal case, since an author imports a folder.
 *
 * ffmpeg's stderr goes in last and verbatim, indented so the block is visibly one thing. It is
 * quoted rather than summarised because the parts that matter are unpredictable; `detail` already
 * carries the summary, and it is the summary the author was shown.
 */
function failureReport(request: MediaConvertRequest, result: MediaTranscodeError): string {
    const lines = [
        `Conversion failed (${result.reason}): ${result.detail}`,
        `  source: ${request.sourcePath}`,
        `  target: ${request.targetPath} [${describeTarget(request)}]`,
    ];
    const stderr = result.stderr.trimEnd();
    lines.push(
        stderr
            ? `  ffmpeg wrote:\n${stderr.split(/\r?\n/).map(line => `    ${line}`).join("\n")}`
            : "  ffmpeg wrote nothing to stderr",
    );
    return lines.join("\n");
}
