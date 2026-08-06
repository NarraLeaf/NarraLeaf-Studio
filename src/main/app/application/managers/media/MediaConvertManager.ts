import crypto from "crypto";
import type {
    MediaConvertRequest,
    MediaConvertStateSnapshot,
} from "@shared/types/mediaConvert";
import { resolveFfmpegBinary, type FfmpegResolveOptions, type FfmpegResolverApp } from "./ffmpegTool";
import { startMediaTranscode, type MediaTranscodeOptions } from "./mediaTranscode";

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
 */

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
                job.snapshot = {
                    ...job.snapshot,
                    status: "done",
                    finishedAt,
                    outputPath: result.outputPath,
                };
            } else if (result.status === "cancelled") {
                job.snapshot = { ...job.snapshot, status: "cancelled", finishedAt };
            } else {
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
