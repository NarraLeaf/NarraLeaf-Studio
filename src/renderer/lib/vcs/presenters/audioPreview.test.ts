import { describe, expect, it } from "vitest";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import { formatClock, formatSampleRate, isAudioEntry, peaksOf, timelineShares } from "./audioPreview";

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
