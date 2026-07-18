import { describe, expect, it } from "vitest";
import { clipDuration, computePeaks, resolveRange, type AudioClip } from "./audioClip";

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

describe("computePeaks", () => {
    it("reports the min and max of each bucket", () => {
        const peaks = computePeaks(clipOf([1, -1, 0.5, -0.5]), { start: 0, end: 4 }, 2);
        expect(Array.from(peaks)).toEqual([-1, 1, -0.5, 0.5]);
    });

    it("spans every channel of a stereo clip", () => {
        const clip: AudioClip = {
            sampleRate: 8000,
            channels: [Float32Array.from([0.25, 0.25]), Float32Array.from([-0.75, -0.75])],
        };
        expect(Array.from(computePeaks(clip, { start: 0, end: 2 }, 1))).toEqual([-0.75, 0.25]);
    });

    it("returns zeros for an empty clip instead of dividing by zero", () => {
        expect(Array.from(computePeaks(clipOf([]), { start: 0, end: 0 }, 2))).toEqual([0, 0, 0, 0]);
    });
});

describe("clipDuration", () => {
    it("is length over sample rate", () => {
        expect(clipDuration({ sampleRate: 100, channels: [new Float32Array(250)] })).toBe(2.5);
    });
});
