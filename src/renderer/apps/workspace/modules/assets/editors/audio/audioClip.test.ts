import { describe, expect, it } from "vitest";
import {
    applyFade,
    applyGain,
    clipDuration,
    clipLength,
    computePeaks,
    cropTo,
    deleteRange,
    encodeWav,
    normalizeRange,
    resolveRange,
    reverseRange,
    silenceRange,
    type AudioClip,
} from "./audioClip";

function clipOf(values: number[], channels = 1): AudioClip {
    return {
        sampleRate: 8000,
        channels: Array.from({ length: channels }, () => Float32Array.from(values)),
    };
}

describe("resolveRange", () => {
    it("treats a null or empty range as the whole clip", () => {
        const clip = clipOf([0, 1, 2, 3]);
        expect(resolveRange(clip, null)).toEqual({ start: 0, end: 4 });
        expect(resolveRange(clip, { start: 2, end: 2 })).toEqual({ start: 0, end: 4 });
    });

    it("normalizes a backwards drag and clamps past the ends", () => {
        const clip = clipOf([0, 1, 2, 3]);
        expect(resolveRange(clip, { start: 3, end: 1 })).toEqual({ start: 1, end: 3 });
        expect(resolveRange(clip, { start: -5, end: 99 })).toEqual({ start: 0, end: 4 });
    });
});

describe("editing operations", () => {
    it("crops to the selection", () => {
        const result = cropTo(clipOf([1, 2, 3, 4, 5]), { start: 1, end: 4 });
        expect(Array.from(result.channels[0])).toEqual([2, 3, 4]);
    });

    it("deletes a range and closes the gap", () => {
        const result = deleteRange(clipOf([1, 2, 3, 4, 5]), { start: 1, end: 3 });
        expect(Array.from(result.channels[0])).toEqual([1, 4, 5]);
    });

    it("silences a range without changing the length", () => {
        const result = silenceRange(clipOf([1, 1, 1, 1]), { start: 1, end: 3 });
        expect(Array.from(result.channels[0])).toEqual([1, 0, 0, 1]);
        expect(clipLength(result)).toBe(4);
    });

    it("clamps gain to the valid sample range", () => {
        const result = applyGain(clipOf([0.5, -0.9]), { start: 0, end: 2 }, 4);
        expect(Array.from(result.channels[0])).toEqual([1, -1]);
    });

    it("fades in from silence and out to silence", () => {
        const faded = applyFade(clipOf([1, 1, 1]), { start: 0, end: 3 }, "in");
        expect(faded.channels[0][0]).toBe(0);
        expect(faded.channels[0][2]).toBe(1);

        const out = applyFade(clipOf([1, 1, 1]), { start: 0, end: 3 }, "out");
        expect(out.channels[0][0]).toBe(1);
        expect(out.channels[0][2]).toBe(0);
    });

    it("reverses only the selected range", () => {
        const result = reverseRange(clipOf([1, 2, 3, 4]), { start: 1, end: 4 });
        expect(Array.from(result.channels[0])).toEqual([1, 4, 3, 2]);
    });

    it("normalizes to the requested peak and leaves silence alone", () => {
        const result = normalizeRange(clipOf([0.25, -0.5]), { start: 0, end: 2 }, 1);
        expect(Array.from(result.channels[0])).toEqual([0.5, -1]);

        const silence = clipOf([0, 0]);
        expect(normalizeRange(silence, { start: 0, end: 2 })).toBe(silence);
    });

    it("edits every channel of a stereo clip", () => {
        const result = deleteRange(clipOf([1, 2, 3], 2), { start: 0, end: 1 });
        expect(result.channels).toHaveLength(2);
        expect(Array.from(result.channels[1])).toEqual([2, 3]);
    });
});

describe("computePeaks", () => {
    it("reports the min and max of each bucket", () => {
        const peaks = computePeaks(clipOf([1, -1, 0.5, -0.5]), { start: 0, end: 4 }, 2);
        expect(Array.from(peaks)).toEqual([-1, 1, -0.5, 0.5]);
    });

    it("returns zeros for an empty clip instead of dividing by zero", () => {
        expect(Array.from(computePeaks(clipOf([]), { start: 0, end: 0 }, 2))).toEqual([0, 0, 0, 0]);
    });
});

describe("encodeWav", () => {
    it("writes a RIFF/WAVE header describing the clip", () => {
        const bytes = encodeWav(clipOf([0, 0.5, -0.5], 2));
        const text = new TextDecoder().decode(bytes.subarray(0, 4));
        const view = new DataView(bytes.buffer);
        expect(text).toBe("RIFF");
        expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WAVE");
        expect(view.getUint16(22, true)).toBe(2); // channels
        expect(view.getUint32(24, true)).toBe(8000); // sample rate
        expect(bytes.length).toBe(44 + 3 * 2 * 2);
    });

    it("maps full-scale samples to the int16 extremes", () => {
        const bytes = encodeWav(clipOf([1, -1]));
        const view = new DataView(bytes.buffer);
        expect(view.getInt16(44, true)).toBe(32767);
        expect(view.getInt16(46, true)).toBe(-32768);
    });
});

describe("clipDuration", () => {
    it("is length over sample rate", () => {
        expect(clipDuration({ sampleRate: 100, channels: [new Float32Array(250)] })).toBe(2.5);
    });
});
