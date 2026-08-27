import type { DownloadProgressEvent, DownloadProgressReporter } from "@shared/types/downloadProgress";

/**
 * Where a worker announces a file it is pulling down.
 *
 * A build fetches things from several depths at once - the code-signing bundle from the packaging
 * step, a Zig toolchain from wherever a protected build needs one, a redistributable from inside the
 * compile - and none of those places has any other reason to know about a progress channel. Passing
 * one down would mean an argument added to every function between the worker's entry point and the
 * `fetch`, most of which are about packing files.
 *
 * So the entry point registers a sink once and the downloaders call {@link reportDownload}. The same
 * shape `downloadRewrites` uses on the main-process side, and for the same reason: one value that
 * belongs to the process rather than to any call.
 *
 * Unset means nobody is listening, which is what a build run from a script or a test is, and every
 * caller has to keep working in that state.
 */

let sink: DownloadProgressReporter | null = null;

/** Wired once by a worker entry point. Tests set their own, or none. */
export function setDownloadReporter(reporter: DownloadProgressReporter | null): void {
    sink = reporter;
}

/** Announce one event, if anything is listening. Never throws - a readout cannot fail a build. */
export function reportDownload(event: DownloadProgressEvent): void {
    try {
        sink?.(event);
    } catch {
        // A broken channel to the parent process is the parent's problem; the file still downloads.
    }
}
