/**
 * The decoded audio behind the read-only audio preview.
 *
 * Samples are kept de-interleaved (one Float32Array per channel) because that is what both
 * `AudioBuffer` and the waveform renderer want. Nothing here mutates a clip — the preview shows
 * and plays the asset, it never rewrites it.
 */

export interface AudioClip {
    sampleRate: number;
    /** One Float32Array per channel, all the same length. */
    channels: Float32Array[];
}

/** A half-open sample range `[start, end)`. */
export interface SampleRange {
    start: number;
    end: number;
}

export function clipLength(clip: AudioClip): number {
    return clip.channels[0]?.length ?? 0;
}

export function clipDuration(clip: AudioClip): number {
    return clipLength(clip) / clip.sampleRate;
}

export function fromAudioBuffer(buffer: AudioBuffer): AudioClip {
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        channels.push(new Float32Array(buffer.getChannelData(channel)));
    }
    return { sampleRate: buffer.sampleRate, channels };
}

/** Clamp a range to the clip and normalize its direction; an empty range means "whole clip". */
export function resolveRange(clip: AudioClip, range: SampleRange | null): SampleRange {
    const length = clipLength(clip);
    if (!range) {
        return { start: 0, end: length };
    }
    const start = Math.max(0, Math.min(length, Math.min(range.start, range.end)));
    const end = Math.max(0, Math.min(length, Math.max(range.start, range.end)));
    return start === end ? { start: 0, end: length } : { start, end };
}

/**
 * Per-bucket peaks for drawing, as `[min, max]` pairs. Min *and* max (rather than a single
 * max-abs) so an asymmetric or DC-offset waveform draws the way an audio editor draws it.
 */
export function computePeaks(clip: AudioClip, range: SampleRange, buckets: number): Float32Array {
    const { start, end } = resolveRange(clip, range);
    const peaks = new Float32Array(buckets * 2);
    const span = end - start;
    if (span <= 0 || buckets <= 0) {
        return peaks;
    }
    const perBucket = span / buckets;
    for (let bucket = 0; bucket < buckets; bucket++) {
        const from = start + Math.floor(bucket * perBucket);
        const to = Math.max(from + 1, start + Math.floor((bucket + 1) * perBucket));
        let minimum = 0;
        let maximum = 0;
        for (const samples of clip.channels) {
            for (let i = from; i < to && i < end; i++) {
                const value = samples[i];
                if (value < minimum) minimum = value;
                if (value > maximum) maximum = value;
            }
        }
        peaks[bucket * 2] = minimum;
        peaks[bucket * 2 + 1] = maximum;
    }
    return peaks;
}
