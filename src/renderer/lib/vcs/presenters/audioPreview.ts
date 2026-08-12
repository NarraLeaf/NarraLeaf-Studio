import type { DocumentDiffEntry } from "@shared/documents/diff";
import { contentClassOfEntry } from "./entrySides";

/**
 * The decisions behind a sound comparison, with no React and no Web Audio in them.
 *
 * Separated for the reason `bitmapPreview.ts` is: each one is a claim that can be quietly wrong on
 * screen and obvious in a test. The one that matters most is {@link timelineShares} - a waveform
 * drawn to fit its own box says nothing about length, and length is most of what changes about a
 * sound file.
 */

/** Whether this presenter draws that file. See {@link contentClassOfEntry}. */
export function isAudioEntry(entry: DocumentDiffEntry): boolean {
    return contentClassOfEntry(entry) === "audio";
}

/**
 * How much of the shared timeline each side occupies.
 *
 * **The whole reason the two waveforms are not simply drawn at the same width.** Two versions of
 * one cue, one three seconds long and one five, look identical stretched to a common box: the
 * peaks line up, the shapes match, and the two extra seconds - the only thing that changed, and
 * the thing that will run over the line of dialogue after it - are invisible. Against the longer
 * side, the shorter one is short.
 *
 * A side that is not there gets zero, which is not the same as a side of zero length: the caller
 * draws no track at all for the first and an empty one for the second.
 *
 * @param before milliseconds, or null for a side that does not hold the file.
 * @returns each side's share of the timeline, from 0 to 1.
 */
export function timelineShares(
    before: number | null,
    after: number | null,
): { before: number; after: number } {
    const longest = Math.max(before ?? 0, after ?? 0);
    if (longest <= 0) {
        // Nothing to be a share of. A present side still fills the timeline, because a track drawn
        // at zero width would read as a file that failed to load rather than as an empty one.
        return { before: before === null ? 0 : 1, after: after === null ? 0 : 1 };
    }
    return {
        before: before === null ? 0 : before / longest,
        after: after === null ? 0 : after / longest,
    };
}

/** The extremes of one bucket of samples, which is what a waveform is drawn from. */
export interface WaveformPeaks {
    /** Lowest sample in each bucket, from -1 to 0. */
    readonly min: Float32Array;
    /** Highest sample in each bucket, from 0 to 1. */
    readonly max: Float32Array;
}

/**
 * The decoded samples reduced to one column per pixel of the waveform.
 *
 * Minimum AND maximum rather than an average of either: an average of a symmetric waveform is
 * zero, so a loud passage and silence average the same, and the picture that comes out is a flat
 * line through the middle of a file that is anything but flat.
 *
 * The channels are folded together by taking the widest excursion of any of them, which is what
 * makes a stereo file's picture the same shape as the mono bounce of it rather than the left
 * channel with the right one hidden behind it.
 */
export function peaksOf(channels: readonly Float32Array[], buckets: number): WaveformPeaks {
    const columns = Math.max(1, Math.floor(buckets));
    const min = new Float32Array(columns);
    const max = new Float32Array(columns);
    const length = channels.reduce((longest, channel) => Math.max(longest, channel.length), 0);
    if (length === 0 || channels.length === 0) {
        return { min, max };
    }

    for (let column = 0; column < columns; column += 1) {
        const from = Math.floor((column * length) / columns);
        // At least one sample per column: a file shorter than the waveform is wide would
        // otherwise leave empty columns scattered through it, which reads as dropouts.
        const to = Math.max(from + 1, Math.floor(((column + 1) * length) / columns));
        let low = 0;
        let high = 0;
        for (const channel of channels) {
            for (let index = from; index < to && index < channel.length; index += 1) {
                const sample = channel[index];
                if (sample < low) low = sample;
                if (sample > high) high = sample;
            }
        }
        min[column] = low;
        max[column] = high;
    }
    return { min, max };
}

/**
 * A position in a sound file, as an author reads one.
 *
 * Minutes and seconds with one decimal, because both halves of the range matter here: a voice line
 * is measured in seconds and a background track in minutes, and a cue that is 0.2 seconds longer
 * than it was is a cue that now overlaps the next one.
 */
export function formatClock(milliseconds: number): string {
    const total = Math.max(0, milliseconds) / 1000;
    const minutes = Math.floor(total / 60);
    const seconds = total - minutes * 60;
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds.toFixed(1)}`;
}

/** A sample rate as it is written on a file's properties, rather than as five digits. */
export function formatSampleRate(hertz: number): string {
    return `${Math.round(hertz / 100) / 10} kHz`;
}
