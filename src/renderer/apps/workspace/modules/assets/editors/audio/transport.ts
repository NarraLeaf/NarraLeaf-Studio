import type { SampleRange } from "./audioClip";

/**
 * A range to play, with the point each repeat returns to.
 *
 * `loopStart` is where the *second* pass begins, which is not always where the first one did: an
 * intro→loop plays `start..loopStart` once and then repeats `loopStart..end` forever. Absent means
 * the two coincide - a plain loop, and what a selection audition has always done.
 */
export interface PlayRange extends SampleRange {
    loopStart?: number;
}

/**
 * The shape of one run of playback, in samples.
 *
 * This is the *only* model of "what is sounding and how it repeats". The playback hook arms the
 * `AudioBufferSourceNode` from it and reads the moving playhead back out of it, so the line on
 * screen and the samples in the speakers cannot describe different loops. They used to: the tick
 * re-derived position as `elapsed % clipLength`, a second model that silently assumed every loop
 * was the whole file, and it disagreed with the audio for every selection audition and could not
 * express an intro→loop at all.
 */
export interface PlaybackGeometry {
    /** Sample this run started at - not necessarily where it returns to. */
    start: number;
    /** Where playback stops, or turns around when {@link looping}. */
    end: number;
    /** Where each repeat resumes from. Equals the range's start for a plain loop. */
    loopStart: number;
    looping: boolean;
}

/**
 * Resolve what a run will actually do, once, so arming and tracking cannot drift apart.
 *
 * With no range this is the whole clip, which is what the source node gets armed with too. With
 * one, `loopStart` is clamped inside it: a stale loop point - the asset's markers outlive the file
 * they were marked on - must never describe a backwards or empty loop, because Web Audio answers
 * that by quietly looping the entire buffer instead.
 */
export function resolvePlaybackGeometry(options: {
    from: number;
    range: PlayRange | null;
    totalSamples: number;
    looping: boolean;
}): PlaybackGeometry {
    const { from, range, totalSamples, looping } = options;
    const start = Math.max(0, Math.min(Math.max(0, totalSamples - 1), from));
    if (!range || range.end <= range.start) {
        return { start, end: totalSamples, loopStart: 0, looping };
    }
    const loopStart = Math.min(Math.max(range.loopStart ?? range.start, range.start), range.end - 1);
    return { start, end: range.end, loopStart, looping };
}

/**
 * Where the playhead is after `elapsedSamples` of a run, mirroring `AudioBufferSourceNode`.
 *
 * The node plays from `start` and, on first reaching `end`, jumps to `loopStart` and repeats
 * `loopStart..end` from then on. That first pass is why a modulo cannot do this job: an intro→loop
 * covers `start..end` once - including the stretch before `loopStart`, which is never visited
 * again - and only then enters a cycle whose period is the loop, not the clip.
 */
export function playbackPosition(geometry: PlaybackGeometry, elapsedSamples: number): number {
    const raw = geometry.start + Math.max(0, elapsedSamples);
    // Not looping: the source stops at the end, so the line parks there rather than wrapping to
    // the head of the file for the frame or two before `onended` lands.
    if (!geometry.looping) {
        return Math.min(raw, geometry.end);
    }
    // Still on the first pass, which is the only pass that can start before the loop point.
    if (raw < geometry.end) {
        return raw;
    }
    const period = geometry.end - geometry.loopStart;
    if (period <= 0) {
        return geometry.loopStart;
    }
    return geometry.loopStart + ((raw - geometry.end) % period);
}

/**
 * Where a press of play should start from.
 *
 * The playhead is a resume point right up until playback reaches the end, and then it is a
 * result: it sits parked on the last sample of whatever just played. Resuming from there would
 * play nothing at all, so a run that finished on its own rewinds to the top of what it was
 * playing - the selection when there is one, the clip when there is not.
 *
 * `finished` comes from the playback hook, which can tell a natural end from a stop because only
 * the former fires `onended`. Position alone cannot: the audio clock stops on a frame boundary,
 * so a finished run parks a few hundred samples either side of the end and no threshold
 * distinguishes that from a deliberate seek to the same spot.
 */
export function resolvePlayStart(options: {
    position: number;
    selection: SampleRange | null;
    totalSamples: number;
    /** True when the previous run ended by reaching the end, rather than being stopped or seeked. */
    finished: boolean;
}): number {
    const { position, selection, totalSamples, finished } = options;
    const hasSelection = Boolean(selection && selection.end > selection.start);
    const start = hasSelection && selection ? selection.start : 0;
    const end = hasSelection && selection ? selection.end : totalSamples;

    if (finished || position >= end) {
        return start;
    }
    // Inside or before the range: resume, but never behind its start - pressing play with the
    // playhead parked ahead of a selection should audition the selection, not the run-up to it.
    return Math.max(start, position);
}
