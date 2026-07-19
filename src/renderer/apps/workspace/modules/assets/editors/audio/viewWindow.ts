import type { SampleRange } from "./audioClip";

/**
 * Zoom/scroll math for the waveform's visible sample window.
 *
 * Kept apart from the component because it is the part that is easy to get subtly wrong - zooming
 * that drifts off the anchor, scrolling that walks past the end, a window that collapses to zero
 * width. Pure functions, so those cases can be pinned down in tests.
 */

/** Never zoom past this many samples across the whole view; below it the picture is meaningless. */
const MIN_VISIBLE_SAMPLES = 64;

export function clampView(view: SampleRange, totalSamples: number): SampleRange {
    const total = Math.max(1, totalSamples);
    const span = Math.min(total, Math.max(MIN_VISIBLE_SAMPLES, Math.round(view.end - view.start)));
    const start = Math.max(0, Math.min(total - span, Math.round(view.start)));
    return { start, end: start + span };
}

export function fitAll(totalSamples: number): SampleRange {
    return { start: 0, end: Math.max(1, totalSamples) };
}

/**
 * Zoom by `factor` (>1 zooms in) keeping `anchor` - the sample under the pointer, or the playhead -
 * at the same relative position, so the thing you are looking at does not slide away.
 */
export function zoomAt(view: SampleRange, totalSamples: number, factor: number, anchor: number): SampleRange {
    const span = view.end - view.start;
    const nextSpan = Math.max(MIN_VISIBLE_SAMPLES, Math.round(span / factor));
    const ratio = span === 0 ? 0.5 : (anchor - view.start) / span;
    const start = Math.round(anchor - ratio * nextSpan);
    return clampView({ start, end: start + nextSpan }, totalSamples);
}

/** Scroll by a fraction of the visible span (positive scrolls right). */
export function scrollByFraction(view: SampleRange, totalSamples: number, fraction: number): SampleRange {
    const span = view.end - view.start;
    const delta = Math.round(span * fraction);
    return clampView({ start: view.start + delta, end: view.end + delta }, totalSamples);
}

/** Frame `range` with a little air on both sides, the way "zoom to selection" behaves. */
export function zoomToRange(range: SampleRange, totalSamples: number, padding = 0.05): SampleRange {
    const span = Math.max(MIN_VISIBLE_SAMPLES, range.end - range.start);
    const air = Math.round(span * padding);
    return clampView({ start: range.start - air, end: range.end + air }, totalSamples);
}

/** Keep `sample` inside the window, scrolling by whole pages like a playhead-following view. */
export function ensureVisible(view: SampleRange, totalSamples: number, sample: number): SampleRange {
    if (sample >= view.start && sample < view.end) {
        return view;
    }
    const span = view.end - view.start;
    return clampView({ start: sample - Math.round(span * 0.1), end: sample + span }, totalSamples);
}
