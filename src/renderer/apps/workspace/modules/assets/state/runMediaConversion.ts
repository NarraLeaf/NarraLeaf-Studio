import type {
    MediaConvertRequest,
    MediaConvertStateSnapshot,
} from "@shared/types/mediaConvert";

/**
 * Driving one conversion from the renderer, and reading its answers honestly.
 *
 * The main process runs the work and is polled for it (`MediaConvertManager`, the shape `gameBuild`
 * established). This is the other end of that poll, kept out of the dialog so the two rules below
 * are stated once, in a file that can be tested without mounting a modal.
 *
 * ## The fraction is not a completion signal
 *
 * ffmpeg emits its last progress block before it exits, and for a short file that block may be the
 * only one: a remux was measured finishing at a final fraction of **0.72**. A loop that waits for
 * the number to reach 1 waits forever, and a bar driven off it alone stops short on exactly the
 * conversions that were fastest. **The loop ends when the status stops being `converting`**, and the
 * bar is filled from the status, not from the number.
 *
 * ## Not knowing is an answer
 *
 * `fraction` is `null` whenever the source had no duration to divide by - every still image, and any
 * stream whose demuxer would not commit to a length. It is passed through as `null` rather than
 * turned into a zero, because a bar that sits at 0% and a bar that has no percentage look nothing
 * alike to the person watching one.
 */

/** The renderer's view of the three IPC calls, injected so the loop is testable without a host. */
export type MediaConvertBridge = {
    /** `null` when the call itself failed, as opposed to the conversion failing. */
    start(request: MediaConvertRequest): Promise<MediaConvertStateSnapshot | null>;
    cancel(jobId: string): Promise<void>;
    getStatus(jobId: string): Promise<MediaConvertStateSnapshot | null>;
};

export type MediaConversionOutcome =
    | { status: "done"; outputPath: string }
    | { status: "stopped" }
    /** No ffmpeg on this machine. Nothing is wrong with the file. */
    | { status: "unavailable"; detail?: string }
    | { status: "failed"; detail?: string };

export type MediaConversionHooks = {
    /** The job id, the moment there is one, so a stop request can reach the running process. */
    onStarted(jobId: string): void;
    /** `null` means the source has no duration; the caller must not invent a number for it. */
    onProgress(fraction: number | null): void;
    /** Waits between polls. Injected so a test does not spend real seconds sleeping. */
    wait(): Promise<void>;
};

/** How often the renderer asks. Fast enough that a two-second remux still moves its bar. */
export const MEDIA_CONVERT_POLL_MS = 200;

/**
 * Run one conversion to completion and say how it ended.
 *
 * Never throws: it is called with a dialog open, and every way it can go wrong has to be something
 * that dialog can render on a row.
 */
export async function runMediaConversion(
    request: MediaConvertRequest,
    bridge: MediaConvertBridge,
    hooks: MediaConversionHooks,
): Promise<MediaConversionOutcome> {
    let snapshot: MediaConvertStateSnapshot | null;
    try {
        snapshot = await bridge.start(request);
    } catch {
        return { status: "failed" };
    }
    if (!snapshot) {
        return { status: "failed" };
    }
    hooks.onStarted(snapshot.jobId);

    while (snapshot && snapshot.status === "converting") {
        if (snapshot.progress) {
            hooks.onProgress(snapshot.progress.fraction);
        }
        await hooks.wait();
        try {
            snapshot = await bridge.getStatus(snapshot.jobId);
        } catch {
            return { status: "failed" };
        }
    }

    if (!snapshot) {
        return { status: "failed" };
    }
    switch (snapshot.status) {
        case "done":
            // `outputPath` is set only once the file is at its final name, so its absence here is a
            // contradiction rather than a variant to render.
            return snapshot.outputPath
                ? { status: "done", outputPath: snapshot.outputPath }
                : { status: "failed", detail: snapshot.error };
        case "cancelled":
            return { status: "stopped" };
        case "unavailable":
            return { status: "unavailable", detail: snapshot.error };
        default:
            // `error` and `idle` alike: a job that aged out mid-run produced no file either.
            return { status: "failed", detail: snapshot.error };
    }
}
