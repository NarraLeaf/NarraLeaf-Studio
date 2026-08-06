import type { MediaSupportVerdict } from "@shared/utils/mediaSupport";

/**
 * The result of asking the main process what is inside a media file.
 *
 * Lives in `shared` rather than beside the implementation because it crosses IPC: the probe itself
 * runs in main (`managers/media/mediaProbe.ts`), and the renderer needs the same type to read the
 * answer. The classification tables it wraps are in `@shared/utils/mediaSupport`.
 */

/** Why a probe produced no verdict. Each arm is a different thing to tell the author. */
export type MediaProbeFailureReason =
    /** The process did not answer within the probe timeout. */
    | "timeout"
    /** ffprobe exited non-zero and printed nothing usable. */
    | "exited"
    /** ffprobe answered, but not with parseable JSON. */
    | "malformed-output"
    /** The binary is present but could not be run at all (permissions, wrong architecture). */
    | "spawn-failed";

export type MediaProbeOutcome =
    | { status: "probed"; verdict: MediaSupportVerdict }
    /**
     * No ffprobe on this host. Distinct from a failure on purpose: nothing is wrong with the
     * *file*, and the caller should say "conversion is unavailable here", not "this file is broken".
     */
    | { status: "unavailable"; detail: string; searched: string[] }
    | { status: "failed"; reason: MediaProbeFailureReason; detail: string };
