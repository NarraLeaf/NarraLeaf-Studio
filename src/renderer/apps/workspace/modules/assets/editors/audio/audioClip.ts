/**
 * The in-memory audio document behind the audio editor, plus the edits that act on it.
 *
 * Everything here is pure: an operation takes a clip and returns a new one, which is what makes
 * undo/redo a plain stack of clips rather than a log of inverse operations. Samples are kept
 * de-interleaved (one Float32Array per channel) because that is what both `AudioBuffer` and the
 * waveform renderer want; interleaving happens only when encoding a WAV.
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

function mapChannels(clip: AudioClip, transform: (samples: Float32Array) => Float32Array): AudioClip {
    return { sampleRate: clip.sampleRate, channels: clip.channels.map(transform) };
}

/** Keep only `range` — Audition's "crop to selection". */
export function cropTo(clip: AudioClip, range: SampleRange): AudioClip {
    const { start, end } = resolveRange(clip, range);
    return mapChannels(clip, samples => samples.slice(start, end));
}

/** Remove `range`, closing the gap. */
export function deleteRange(clip: AudioClip, range: SampleRange): AudioClip {
    const { start, end } = resolveRange(clip, range);
    return mapChannels(clip, samples => {
        const next = new Float32Array(samples.length - (end - start));
        next.set(samples.subarray(0, start), 0);
        next.set(samples.subarray(end), start);
        return next;
    });
}

/** Zero `range` in place of removing it, so the timing of everything after is preserved. */
export function silenceRange(clip: AudioClip, range: SampleRange): AudioClip {
    const { start, end } = resolveRange(clip, range);
    return mapChannels(clip, samples => {
        const next = new Float32Array(samples);
        next.fill(0, start, end);
        return next;
    });
}

/** Multiply `range` by a linear factor (2.0 = +6 dB), clamped to the valid sample range. */
export function applyGain(clip: AudioClip, range: SampleRange, factor: number): AudioClip {
    const { start, end } = resolveRange(clip, range);
    return mapChannels(clip, samples => {
        const next = new Float32Array(samples);
        for (let i = start; i < end; i++) {
            next[i] = Math.max(-1, Math.min(1, next[i] * factor));
        }
        return next;
    });
}

/** Linear fade across `range`; `direction` picks which end is silent. */
export function applyFade(clip: AudioClip, range: SampleRange, direction: "in" | "out"): AudioClip {
    const { start, end } = resolveRange(clip, range);
    const span = end - start;
    if (span <= 1) {
        return clip;
    }
    return mapChannels(clip, samples => {
        const next = new Float32Array(samples);
        for (let i = start; i < end; i++) {
            const progress = (i - start) / (span - 1);
            next[i] *= direction === "in" ? progress : 1 - progress;
        }
        return next;
    });
}

export function reverseRange(clip: AudioClip, range: SampleRange): AudioClip {
    const { start, end } = resolveRange(clip, range);
    return mapChannels(clip, samples => {
        const next = new Float32Array(samples);
        for (let i = start, j = end - 1; i < j; i++, j--) {
            const temporary = next[i];
            next[i] = next[j];
            next[j] = temporary;
        }
        return next;
    });
}

/**
 * Scale `range` so its loudest sample reaches `peak`. Silence is left alone — there is nothing to
 * normalize, and dividing by its zero peak would produce infinities.
 */
export function normalizeRange(clip: AudioClip, range: SampleRange, peak = 0.99): AudioClip {
    const { start, end } = resolveRange(clip, range);
    let loudest = 0;
    for (const samples of clip.channels) {
        for (let i = start; i < end; i++) {
            const magnitude = Math.abs(samples[i]);
            if (magnitude > loudest) {
                loudest = magnitude;
            }
        }
    }
    if (loudest === 0) {
        return clip;
    }
    return applyGain(clip, range, peak / loudest);
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

/** Encode as 16-bit PCM WAV — the format every consumer of an exported clip can read. */
export function encodeWav(clip: AudioClip): Uint8Array {
    const channelCount = Math.max(1, clip.channels.length);
    const frames = clipLength(clip);
    const bytesPerSample = 2;
    const blockAlign = channelCount * bytesPerSample;
    const dataSize = frames * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeAscii = (offset: number, text: string) => {
        for (let i = 0; i < text.length; i++) {
            view.setUint8(offset + i, text.charCodeAt(i));
        }
    };

    writeAscii(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(8, "WAVE");
    writeAscii(12, "fmt ");
    view.setUint32(16, 16, true); // PCM header size
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, channelCount, true);
    view.setUint32(24, clip.sampleRate, true);
    view.setUint32(28, clip.sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 8 * bytesPerSample, true);
    writeAscii(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let frame = 0; frame < frames; frame++) {
        for (let channel = 0; channel < channelCount; channel++) {
            const sample = Math.max(-1, Math.min(1, clip.channels[channel]?.[frame] ?? 0));
            // Asymmetric scaling: -1 maps to -32768, +1 to 32767, matching int16's range.
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }
    return new Uint8Array(buffer);
}
