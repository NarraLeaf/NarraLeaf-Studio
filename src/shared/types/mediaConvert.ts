import type { MediaSupportTarget } from "@shared/utils/mediaSupport";

/**
 * Converting a file, as opposed to deciding whether it needs converting.
 *
 * The decision lives in `@shared/utils/mediaSupport` and produces a {@link MediaSupportTarget}. This
 * module is the other half: what the caller asks for, what it hears back while the work runs, and
 * what it is told when the work stops. Everything here crosses IPC, so it is plain data — no
 * classes, no callbacks, nothing that would not survive a structured clone.
 *
 * The engine that acts on these types is `managers/media/mediaTranscode.ts`; the session bookkeeping
 * is `managers/media/MediaConvertManager.ts`.
 */

/* -------------------------------------------------------------------------------------------- */
/* Targets                                                                                        */
/* -------------------------------------------------------------------------------------------- */

/**
 * Turn a still image into a PNG.
 *
 * Separate from {@link MediaSupportTarget} rather than folded into it, because the classifier that
 * produces those answers a question about *decodable streams* — container demuxing, codec support,
 * cover-art disposition — and none of that applies to a TIFF. A still image has no container to
 * demux, no duration, and nothing for the progress reporter to divide by. Sharing the union would
 * have meant every consumer of a support verdict pretending an image could come out of it.
 *
 * PNG and nothing else, and **no quality parameter anywhere on this path**. The conversion exists
 * because Chromium has no TIFF decoder, not because the file is too big; a lossy answer to "your
 * editor cannot open this" would silently degrade artwork the author believes was merely relabelled.
 */
export type MediaImageTarget = {
    kind: "image";
    container: "png";
};

/** Everything the transcoder knows how to produce. */
export type MediaConvertTarget = MediaSupportTarget | MediaImageTarget;

/**
 * Image extensions that reach a browser and produce nothing, and which FFmpeg can decode.
 *
 * The same three the asset import path refuses
 * (`renderer/lib/workspace/services/assets/FileFormatValidator.ts`, `UNDECODABLE_EXTENSIONS`),
 * measured against Chromium 140: TIFF has no decoder at all, and XBM — an X11-era C source format —
 * was measured failing too. Duplicated rather than imported because `shared` must not depend on
 * `renderer`.
 *
 * **Exported so the duplication can be tested rather than trusted.** Two tables that have to agree
 * and cannot import each other drift, and the last time this exact pair drifted `.opus` and `.apng`
 * became impossible to import at all. `mediaImportTriage.test.ts` asserts the two are equal, so the
 * next person to add an extension to one is told about the other.
 */
export const CONVERTIBLE_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["tif", "tiff", "xbm"]);

/** Lowercased extension without the dot, from a full path or a bare name. Empty when there is none. */
export function fileExtensionOf(fileName: string): string {
    const base = fileName.replace(/\\/g, "/").split("/").pop() ?? "";
    const dot = base.lastIndexOf(".");
    return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/**
 * The image conversion this file needs, or `null` if it is not one of the three.
 *
 * Decided by extension, unlike every media verdict in `mediaSupport.ts` — and legitimately so. The
 * reason the media rules cannot use the extension is that one container holds many codecs, so
 * `.mp4` is two different answers. A `.tif` is a TIFF; there is no second thing it could be, and no
 * codec axis to be wrong about.
 */
export function imageConvertTargetFor(fileName: string): MediaImageTarget | null {
    return CONVERTIBLE_IMAGE_EXTENSIONS.has(fileExtensionOf(fileName))
        ? { kind: "image", container: "png" }
        : null;
}

/**
 * The file extension a target's output should carry, without the dot.
 *
 * Mostly the container's own name. The exception is MP4 with no video stream, which is written
 * `.m4a`: the bytes are an ordinary MP4, but the audio-only convention is what players, the OS file
 * associations and the iOS shell's extension table all expect, and a `.mp4` that turns out to be
 * music is a small lie that surfaces as a broken-looking video element later.
 */
/**
 * The extension the converted file is written with.
 *
 * Not cosmetic on iOS. The shell serves the site through a `WKURLSchemeHandler` that derives the
 * media type from this extension, and WebKit - unlike Chromium - does not sniff the container when
 * the declared type is wrong. `.mp4` is typed `video/mp4` there, so a sound file written `.mp4` is
 * announced as a video and does not play. Audio-only MP4 is therefore `.m4a`, which the shell's
 * table types `audio/mp4`, and both routes into an MP4 have to say so: `reencode` knows it from
 * `video` being null, `remux` from its `audioOnly` flag.
 */
export function mediaConvertTargetExtension(target: MediaConvertTarget): string {
    if (target.kind === "image") {
        return target.container;
    }
    if (target.container === "mp4") {
        const audioOnly = target.kind === "reencode" ? target.video === null : target.audioOnly;
        if (audioOnly) {
            return "m4a";
        }
    }
    return target.container;
}

/* -------------------------------------------------------------------------------------------- */
/* Progress                                                                                       */
/* -------------------------------------------------------------------------------------------- */

/**
 * How far along a conversion is.
 *
 * `fraction` is `null` — not `0`, not an estimate — whenever the source duration is unknown. Two
 * cases produce that honestly: a still image, which has no duration to be a fraction of, and a
 * source whose demuxer would not commit to one. A progress bar that invents a number for those
 * either sticks at a value that never moves or races to 100% and sits there, and both read as a
 * hung conversion. Showing no percentage is the accurate thing to show.
 */
export type MediaConvertProgress = {
    /** Microseconds of output written so far, straight from ffmpeg's `out_time_us`. */
    outTimeUs: number | null;
    /** Source duration in microseconds, as the probe reported it. */
    durationUs: number | null;
    /** `outTimeUs / durationUs`, clamped to 0..1. `null` when the duration is unknown. */
    fraction: number | null;
};

/* -------------------------------------------------------------------------------------------- */
/* Requests and state                                                                             */
/* -------------------------------------------------------------------------------------------- */

export type MediaConvertRequest = {
    /** Absolute path to read. Never written to, under any outcome. */
    sourcePath: string;
    /** Absolute path to create. Must not already exist. */
    targetPath: string;
    target: MediaConvertTarget;
    /**
     * Source duration in microseconds from the probe that produced `target`, or `null` when it had
     * none. Passing `null` costs a progress percentage and nothing else; passing a wrong number
     * costs a progress bar that lies, so callers that are unsure should pass `null`.
     */
    durationUs: number | null;
};

/**
 * Why a conversion stopped without producing a file.
 *
 * Each arm is a different thing to tell the author, which is the whole reason they are not one
 * caught exception.
 */
export type MediaConvertFailureReason =
    /** The source is gone or is not a file. Checked before spawning, and reachable again mid-run. */
    | "source-missing"
    /** Something is already at the target path. Nothing is overwritten, ever. */
    | "target-exists"
    /** The binary is present but would not start (permissions, wrong architecture). */
    | "spawn-failed"
    /** ffmpeg ran and exited non-zero. `detail` carries the tail of its stderr. */
    | "exited"
    /** The conversion produced a file that could not be moved into place. */
    | "write-failed";

export type MediaConvertStatus =
    /** No such job — the id is unknown, or its record has aged out. */
    | "idle"
    | "converting"
    | "done"
    | "cancelled"
    | "error"
    /**
     * No ffmpeg on this host. Distinct from `error` for the same reason the probe distinguishes it:
     * nothing is wrong with the file, and the author should be told conversion is unavailable here
     * rather than that their video is broken.
     */
    | "unavailable";

/**
 * A conversion as the renderer sees it.
 *
 * Polled, in the shape `gameBuild` established (`GameBuildStateSnapshot`): a status enum, timestamps
 * and an error string, fetched with `getStatus` between a `start` and a `cancel`. Following that
 * rather than inventing a push channel keeps one long-task idiom in the app, and the reason it
 * exists holds here too — a renderer that stops listening must not be able to leave the main process
 * emitting into nothing, and a window that reloads mid-conversion has to be able to find the job
 * again from its id alone.
 */
export type MediaConvertStateSnapshot = {
    /** Opaque handle from `start`. The only thing `cancel` and `getStatus` are keyed by. */
    jobId: string;
    status: MediaConvertStatus;
    startedAt?: number;
    finishedAt?: number;
    /**
     * Absent until ffmpeg has reported at least once.
     *
     * **Completion is `status`, never `fraction`.** The last progress block is emitted before the
     * process exits, and for a short file it may be the only one — a measured remux finished `done`
     * with a final fraction of 0.72, because the source's declared duration was longer than the
     * position of the last block ffmpeg got round to printing. A bar driven off this number alone
     * stops short on exactly the conversions that were fastest.
     */
    progress?: MediaConvertProgress;
    /** Set only on `done`, and only once the file is at its final path. */
    outputPath?: string;
    reason?: MediaConvertFailureReason;
    /** One human-readable sentence. On `exited`, the tail of ffmpeg's stderr. */
    error?: string;
};
