import { describe, expect, it } from "vitest";
import type { AudioClip } from "./audioClip";
import { integratedLoudness, kWeightingFilters, measureLevels } from "./levels";

function sine(options: { seconds: number; amplitude: number; frequency?: number; sampleRate?: number }): Float32Array {
    const sampleRate = options.sampleRate ?? 48000;
    const frequency = options.frequency ?? 997;
    const samples = new Float32Array(Math.round(options.seconds * sampleRate));
    for (let index = 0; index < samples.length; index++) {
        samples[index] = options.amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
    }
    return samples;
}

describe("kWeightingFilters", () => {
    it("reproduces the BS.1770 coefficient table at 48 kHz", () => {
        const [shelf, highPass] = kWeightingFilters(48000);
        expect(shelf.b0).toBeCloseTo(1.53512485958697, 10);
        expect(shelf.b1).toBeCloseTo(-2.69169618940638, 10);
        expect(shelf.b2).toBeCloseTo(1.19839281085285, 10);
        expect(shelf.a1).toBeCloseTo(-1.69065929318241, 10);
        expect(shelf.a2).toBeCloseTo(0.73248077421585, 10);
        expect(highPass.a1).toBeCloseTo(-1.99004745483398, 10);
        expect(highPass.a2).toBeCloseTo(0.99007225036621, 10);
    });
});

describe("integratedLoudness", () => {
    // The standard's own calibration: a full-scale 1 kHz tone in one front channel reads -3.01 LKFS.
    it("reads a full-scale tone in one channel as -3.01 LUFS", () => {
        const clip: AudioClip = { sampleRate: 48000, channels: [sine({ seconds: 5, amplitude: 1 })] };
        expect(integratedLoudness(clip)).toBeCloseTo(-3.01, 1);
    });

    it("sums the two channels of a stereo clip", () => {
        const channel = sine({ seconds: 5, amplitude: 0.1 });
        const clip: AudioClip = { sampleRate: 48000, channels: [channel, channel] };
        // -20 dBFS per channel is -23.01 LUFS alone and 3 dB more as a pair.
        expect(integratedLoudness(clip)).toBeCloseTo(-20, 1);
    });

    it("measures the same tone the same at 44.1 kHz", () => {
        const clip: AudioClip = {
            sampleRate: 44100,
            channels: [sine({ seconds: 5, amplitude: 0.1, sampleRate: 44100 })],
        };
        expect(integratedLoudness(clip)).toBeCloseTo(-23.01, 1);
    });

    it("gates out silence rather than averaging it in", () => {
        const sampleRate = 48000;
        const tone = sine({ seconds: 4, amplitude: 0.1 });
        const padded = new Float32Array(sampleRate * 12);
        padded.set(tone, sampleRate * 4);
        const clip: AudioClip = { sampleRate, channels: [padded] };
        expect(integratedLoudness(clip)).toBeCloseTo(-23.01, 0);
    });

    it("has no reading for a clip shorter than one block, or one that is silent", () => {
        expect(integratedLoudness({ sampleRate: 48000, channels: [sine({ seconds: 0.3, amplitude: 1 })] })).toBeNull();
        expect(integratedLoudness({ sampleRate: 48000, channels: [new Float32Array(48000 * 2)] })).toBeNull();
    });
});

describe("measureLevels", () => {
    it("reports the peak in dBFS", () => {
        const levels = measureLevels({ sampleRate: 48000, channels: [sine({ seconds: 1, amplitude: 0.5 })] });
        expect(levels.peakDb).toBeCloseTo(-6.02, 1);
    });

    it("measures the silence at either end", () => {
        const sampleRate = 48000;
        const samples = new Float32Array(sampleRate * 3);
        samples.set(sine({ seconds: 1, amplitude: 0.5 }), sampleRate / 2);
        const levels = measureLevels({ sampleRate, channels: [samples] });
        expect(levels.leadingSilenceSeconds).toBeCloseTo(0.5, 2);
        expect(levels.trailingSilenceSeconds).toBeCloseTo(1.5, 2);
    });

    it("takes silence from whichever channel sounds first and last", () => {
        const sampleRate = 1000;
        const left = new Float32Array(1000);
        const right = new Float32Array(1000);
        left[100] = 0.5;
        right[900] = 0.5;
        const levels = measureLevels({ sampleRate, channels: [left, right] });
        expect(levels.leadingSilenceSeconds).toBeCloseTo(0.1, 3);
        expect(levels.trailingSilenceSeconds).toBeCloseTo(0.099, 3);
    });

    it("counts a silent clip as silence end to end", () => {
        const levels = measureLevels({ sampleRate: 1000, channels: [new Float32Array(2000)] });
        expect(levels.peakDb).toBe(-Infinity);
        expect(levels.loudnessLufs).toBeNull();
        expect(levels.leadingSilenceSeconds).toBe(2);
        expect(levels.trailingSilenceSeconds).toBe(2);
    });

    it("counts flat runs at full scale, not single peaks that touch it", () => {
        const samples = new Float32Array(100);
        // A normalised peak: one sample at the ceiling.
        samples[10] = 1;
        // Two separate runs of three.
        samples.fill(1, 30, 33);
        samples.fill(-1, 60, 65);
        const levels = measureLevels({ sampleRate: 1000, channels: [samples] });
        expect(levels.clippedRuns).toBe(2);
    });

    it("counts any run past full scale, however short", () => {
        const samples = new Float32Array(100);
        // A lossy decode of a master limited to 0 dBFS: single samples just over the ceiling.
        samples[20] = 1.06;
        samples[21] = 0.9995;
        samples[50] = -1.02;
        // A clean peak at the ceiling still does not count.
        samples[80] = 0.9995;
        const levels = measureLevels({ sampleRate: 1000, channels: [samples] });
        expect(levels.clippedRuns).toBe(2);
    });

    it("counts a run that crosses a slice boundary once", () => {
        const length = (1 << 17) + 10;
        const samples = new Float32Array(length);
        samples.fill(1, (1 << 17) - 2, (1 << 17) + 3);
        const levels = measureLevels({ sampleRate: 48000, channels: [samples] });
        expect(levels.clippedRuns).toBe(1);
    });
});
