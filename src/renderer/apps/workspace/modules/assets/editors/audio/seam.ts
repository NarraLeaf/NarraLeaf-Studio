import type { LoopPoints } from "./loopHistory";
import type { PlayRange } from "./transport";

/**
 * The loop seam: the last sample a looping clip plays before it turns around, and the sample it
 * turns around to.
 *
 * Every looping clip has one, marked or not. With no markers it is the end of the file running
 * into its head, which is what a scene's music does with an unmarked BGM. Each side records which
 * marker placed it, so the preview can name it and a drag on that side knows what it moves.
 */
export interface LoopSeam {
    /** Where playback turns around, in samples - exclusive, like every range end here. */
    end: number;
    /** Where each repeat resumes, in samples. */
    start: number;
    endSource: "out" | "clipEnd";
    startSource: "loop" | "in" | "clipStart";
}

/**
 * Resolve the seam the running game will play for these markers.
 *
 * The same reading as the preview's own looping audition: an absent out point is the end of the
 * file, an absent loop point falls back to the in point, and an absent in point to the head of the
 * file. Positions are clamped to the clip, because markers outlive the file they were placed on.
 * `null` when the markers describe no playable loop.
 */
export function resolveLoopSeam(loop: LoopPoints, totalSamples: number, sampleRate: number): LoopSeam | null {
    if (totalSamples <= 0 || sampleRate <= 0) {
        return null;
    }
    const toSample = (ms: number) => Math.max(0, Math.min(totalSamples, Math.round((ms / 1000) * sampleRate)));
    const end = loop.outMs === null ? totalSamples : toSample(loop.outMs);
    const start = loop.loopStartMs !== null
        ? toSample(loop.loopStartMs)
        : loop.inMs !== null
            ? toSample(loop.inMs)
            : 0;
    if (end <= start) {
        return null;
    }
    return {
        end,
        start,
        endSource: loop.outMs === null ? "clipEnd" : "out",
        startSource: loop.loopStartMs !== null ? "loop" : loop.inMs !== null ? "in" : "clipStart",
    };
}

/**
 * The marker a drag on one side of the seam moves.
 *
 * Whichever marker placed that side, so dragging reads as adjusting the point that is already
 * there. A side placed by the file itself has no marker yet: dragging the tail sets an out point,
 * and dragging the head sets a loop point rather than an in point, because a loop point leaves the
 * first pass through the clip where it was and only changes where the repeats resume.
 */
export function seamDragMarker(seam: LoopSeam, side: "end" | "start"): "in" | "loop" | "out" {
    if (side === "end") {
        return "out";
    }
    return seam.startSource === "in" ? "in" : "loop";
}

/** Seconds of the loop's tail an audition plays before the seam, and of its head after it. */
export const SEAM_AUDITION_SECONDS = 3;

export interface SeamAudition {
    /** Sample the run starts from. */
    from: number;
    /** The looping range, turning around at the seam. */
    range: PlayRange;
    /** How long the run sounds before it stops, in seconds. */
    seconds: number;
}

/**
 * A short run across the seam: the last few seconds of the loop, the turnaround, and the first few
 * seconds of the repeat. Hearing a seam otherwise means sitting through the whole loop body, which
 * for a BGM is minutes per listen.
 */
export function planSeamAudition(seam: LoopSeam, sampleRate: number, seconds = SEAM_AUDITION_SECONDS): SeamAudition {
    const roll = Math.round(seconds * sampleRate);
    const from = Math.max(0, seam.end - roll);
    return {
        from,
        range: { start: seam.start, end: seam.end, loopStart: seam.start },
        seconds: (seam.end - from) / sampleRate + seconds,
    };
}
