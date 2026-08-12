import { describe, expect, it } from "vitest";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import {
    AUDIO_DECODE_BYTE_BUDGET,
    estimateDecodedBytes,
    formatClock,
    formatSampleRate,
    isAudioEntry,
    peaksOf,
    timelineShares,
    withinDecodeBudget,
} from "./audioPreview";

/**
 * The three decisions a sound comparison is made of that are wrong in ways nobody would notice on
 * screen: claiming a file this cannot play, drawing two lengths as one length, and reducing a
 * waveform to a picture of nothing.
 */

const entry = (path: string, over: Partial<DocumentDiffEntry> = {}): DocumentDiffEntry => ({
    path,
    kind: "changed",
    diff: { changes: [], complete: true, total: 0, tier: "content" },
    ...over,
});

describe("which files this draws", () => {
    it("claims what the comparison classified as sound, name or no name", () => {
        expect(isAudioEntry(entry("assets/content/99/55/3d15abb54213bad7203798a1adc4", {
            contentClass: "audio",
        }))).toBe(true);
        expect(isAudioEntry(entry("assets/content/theme.mp3"))).toBe(true);
        expect(isAudioEntry(entry("assets/content/line.ogg"))).toBe(true);
    });

    it("declines everything else, including a name the bytes contradicted", () => {
        expect(isAudioEntry(entry("assets/content/sprite.png"))).toBe(false);
        expect(isAudioEntry(entry("editor/story/index.json"))).toBe(false);
        // The name says MP3, the bytes said otherwise, and the bytes are the evidence.
        expect(isAudioEntry(entry("assets/content/fake.mp3", { contentClass: "bitmap" }))).toBe(false);
    });
});

describe("how long each side is drawn", () => {
    it("gives the shorter version exactly its share of the longer one", () => {
        // The claim the whole presenter rests on. Two waveforms drawn at the same width are two
        // pictures of a shape, and the shape is not what changed: a cue that runs two seconds
        // longer is a cue that now overlaps the line after it.
        expect(timelineShares(3000, 5000)).toEqual({ before: 0.6, after: 1 });
        expect(timelineShares(5000, 3000)).toEqual({ before: 1, after: 0.6 });
    });

    it("keeps the ratio of the two shares equal to the ratio of the two lengths", () => {
        const shares = timelineShares(1234, 4321);

        expect(shares.before / shares.after).toBeCloseTo(1234 / 4321, 10);
    });

    it("fills the timeline when both versions are the same length", () => {
        expect(timelineShares(2500, 2500)).toEqual({ before: 1, after: 1 });
    });

    it("gives a side that does not hold the file nothing at all", () => {
        expect(timelineShares(null, 4000)).toEqual({ before: 0, after: 1 });
        expect(timelineShares(4000, null)).toEqual({ before: 1, after: 0 });
        expect(timelineShares(null, null)).toEqual({ before: 0, after: 0 });
    });

    it("draws an empty file full width rather than at nothing", () => {
        // Zero length is a fact about the file; zero width would read as one that failed to load.
        expect(timelineShares(0, 0)).toEqual({ before: 1, after: 1 });
    });
});

describe("reducing samples to a waveform", () => {
    const ramp = (length: number, value: number): Float32Array => new Float32Array(length).fill(value);

    it("keeps both extremes, so a loud passage is not averaged into silence", () => {
        // Alternating +1 and -1 averages to zero at every scale. An average-based waveform draws
        // this as a flat line, which is the exact opposite of what it is.
        const samples = new Float32Array(64);
        for (let index = 0; index < samples.length; index += 1) {
            samples[index] = index % 2 === 0 ? 1 : -1;
        }

        const peaks = peaksOf([samples], 8);

        expect([...peaks.max]).toEqual(Array(8).fill(1));
        expect([...peaks.min]).toEqual(Array(8).fill(-1));
    });

    it("folds the channels together by their widest excursion", () => {
        const peaks = peaksOf([ramp(32, 0.25), ramp(32, -0.75)], 4);

        expect([...peaks.max]).toEqual(Array(4).fill(0.25));
        expect([...peaks.min]).toEqual(Array(4).fill(-0.75));
    });

    it("answers with the columns it was asked for, whatever it was given", () => {
        expect(peaksOf([], 16).min).toHaveLength(16);
        expect(peaksOf([new Float32Array(0)], 16).max).toHaveLength(16);
        // Fewer samples than columns: every column still gets one, so a short file is a short
        // waveform rather than a dotted one.
        expect([...peaksOf([ramp(3, 1)], 6).max]).toEqual(Array(6).fill(1));
    });
});

describe("how the numbers read", () => {
    it("writes a position in minutes and tenths, at both ends of the range", () => {
        expect(formatClock(0)).toBe("0:00.0");
        expect(formatClock(3200)).toBe("0:03.2");
        expect(formatClock(83400)).toBe("1:23.4");
        expect(formatClock(600000)).toBe("10:00.0");
    });

    it("writes a sample rate the way a file's properties do", () => {
        expect(formatSampleRate(44100)).toBe("44.1 kHz");
        expect(formatSampleRate(48000)).toBe("48 kHz");
        expect(formatSampleRate(22050)).toBe("22.1 kHz");
    });
});

/**
 * The decode gate.
 *
 * It is checked before decoding on purpose, and that is the whole of what these pin: a budget
 * consulted after `decodeAudioData` has returned is a budget that has already been spent. Two
 * sides of a sixteen minute stereo track are some 680 MB, and the read that feeds them is allowed
 * up to the preview ceiling, so without the gate one row of a list can exhaust the renderer.
 */
describe("decode budget", () => {
    it("measures a decode from the header rather than by attempting it", () => {
        // Ten minutes, stereo, 44.1 kHz, four bytes a sample.
        expect(estimateDecodedBytes({ durationMs: 600_000, sampleRate: 44_100, channels: 2 }))
            .toBe(600 * 44_100 * 2 * 4);
    });

    it("assumes stereo when the header does not say, because guessing low lets the big ones through", () => {
        expect(estimateDecodedBytes({ durationMs: 1_000, sampleRate: 44_100 }))
            .toBe(estimateDecodedBytes({ durationMs: 1_000, sampleRate: 44_100, channels: 2 }));
    });

    it("refuses a track whose decode would not fit", () => {
        // Sixteen minutes of stereo is about 340 MB, five times over.
        expect(withinDecodeBudget({ durationMs: 960_000, sampleRate: 44_100, channels: 2 })).toBe(false);
    });

    it("admits an ordinary background loop", () => {
        expect(withinDecodeBudget({ durationMs: 150_000, sampleRate: 44_100, channels: 2 })).toBe(true);
    });

    it("admits a header that cannot say, because most variable bitrate files cannot", () => {
        // Refusing the unmeasurable would withhold the waveform for ordinary files; the read
        // ceiling is the backstop for those.
        expect(estimateDecodedBytes({ sampleRate: 44_100, channels: 2 })).toBeNull();
        expect(withinDecodeBudget(null)).toBe(true);
        expect(withinDecodeBudget({ durationMs: 0, sampleRate: 44_100 })).toBe(true);
    });

    it("keeps the budget under what one side of a preview read could decode to", () => {
        // Guards the constant itself: a budget raised past the point of the gate is not a gate.
        expect(AUDIO_DECODE_BYTE_BUDGET).toBeLessThan(340 * 1024 * 1024);
    });
});
