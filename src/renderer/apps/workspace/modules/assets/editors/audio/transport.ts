import type { SampleRange } from "./audioClip";

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
