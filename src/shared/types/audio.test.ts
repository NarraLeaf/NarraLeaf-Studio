import { describe, expect, it } from "vitest";
import {
    AUDIO_GAIN_MIN_DB,
    clipSoundConfig,
    clipVolume,
    hasClipMarkers,
    LOOP_TO_END_OF_FILE_SECONDS,
    normalizeAudioClipRegion,
} from "./audio";

/**
 * The region normalizer is the one place the editor and the game agree on what a clip's markers
 * mean, so these cover the shape as it is stored, the shape that preceded it, and every rule that
 * can take a marker away.
 */

describe("normalizeAudioClipRegion", () => {
    it("returns null when there is nothing to read", () => {
        expect(normalizeAudioClipRegion(undefined)).toBeNull();
        expect(normalizeAudioClipRegion(null)).toBeNull();
        expect(normalizeAudioClipRegion("audioLoop")).toBeNull();
        expect(normalizeAudioClipRegion({})).toBeNull();
        expect(normalizeAudioClipRegion({ audioLoop: {} })).toBeNull();
    });

    it("round-trips the stored shape", () => {
        expect(normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900 } })).toEqual({
            inMs: 100,
            outMs: 900,
        });
        expect(normalizeAudioClipRegion({ audioLoop: { inMs: 0, outMs: 900, loopStartMs: 400 } })).toEqual({
            inMs: 0,
            outMs: 900,
            loopStartMs: 400,
        });
    });

    it("keeps each marker on its own", () => {
        expect(normalizeAudioClipRegion({ audioLoop: { inMs: 100 } })).toEqual({ inMs: 100 });
        expect(normalizeAudioClipRegion({ audioLoop: { outMs: 900 } })).toEqual({ outMs: 900 });
        // A lone loop point is a whole-file clip that returns to a spot partway in - the classic
        // single-file intro→loop with no trimming at either end.
        expect(normalizeAudioClipRegion({ audioLoop: { loopStartMs: 900 } })).toEqual({ loopStartMs: 900 });
    });

    it("rejects values that are not finite non-negative numbers", () => {
        expect(normalizeAudioClipRegion({ audioLoop: { inMs: -1, outMs: 900 } })).toEqual({ outMs: 900 });
        expect(normalizeAudioClipRegion({ audioLoop: { inMs: "100", outMs: 900 } })).toEqual({ outMs: 900 });
        expect(normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: Number.NaN } })).toEqual({ inMs: 100 });
        expect(normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900, loopStartMs: -5 } })).toEqual({
            inMs: 100,
            outMs: 900,
        });
        expect(normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900, loopStartMs: Infinity } })).toEqual({
            inMs: 100,
            outMs: 900,
        });
    });

    it("drops an out point that does not sit after the in point", () => {
        expect(normalizeAudioClipRegion({ audioLoop: { inMs: 900, outMs: 100 } })).toEqual({ inMs: 900 });
        expect(normalizeAudioClipRegion({ audioLoop: { inMs: 900, outMs: 900 } })).toEqual({ inMs: 900 });
    });

    describe("the loop point's window", () => {
        it("accepts a loop point sitting on the in point", () => {
            expect(normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900, loopStartMs: 100 } })).toEqual({
                inMs: 100,
                outMs: 900,
                loopStartMs: 100,
            });
        });

        it("accepts a loop point inside the region", () => {
            expect(normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900, loopStartMs: 899 } })).toEqual({
                inMs: 100,
                outMs: 900,
                loopStartMs: 899,
            });
        });

        it("drops a loop point before the in point rather than clamping it there", () => {
            expect(normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900, loopStartMs: 99 } })).toEqual({
                inMs: 100,
                outMs: 900,
            });
        });

        it("drops a loop point at or past the out point", () => {
            expect(normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900, loopStartMs: 900 } })).toEqual({
                inMs: 100,
                outMs: 900,
            });
            expect(normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900, loopStartMs: 1200 } })).toEqual({
                inMs: 100,
                outMs: 900,
            });
        });

        it("leaves an unmarked end open rather than treating it as a bound", () => {
            // No in point: the window starts at the head of the file.
            expect(normalizeAudioClipRegion({ audioLoop: { outMs: 900, loopStartMs: 400 } })).toEqual({
                outMs: 900,
                loopStartMs: 400,
            });
            // No out point: the window runs to the tail of the file.
            expect(normalizeAudioClipRegion({ audioLoop: { inMs: 100, loopStartMs: 40_000 } })).toEqual({
                inMs: 100,
                loopStartMs: 40_000,
            });
        });

        it("re-checks the window against the out point that survived, not the one that was stored", () => {
            // The out point is dropped for sitting before the in point; the loop point then has
            // only the in point to satisfy, and does.
            expect(normalizeAudioClipRegion({ audioLoop: { inMs: 900, outMs: 100, loopStartMs: 950 } })).toEqual({
                inMs: 900,
                loopStartMs: 950,
            });
        });

        it("drops the loop point when it is the only marker left standing outside the window", () => {
            expect(normalizeAudioClipRegion({ audioLoop: { inMs: 900, outMs: 100, loopStartMs: 500 } })).toEqual({
                inMs: 900,
            });
        });
    });

    describe("the superseded cue-point list", () => {
        it("reads the earliest two markers as in and out", () => {
            expect(normalizeAudioClipRegion({ cuePoints: [{ timeMs: 800 }, { timeMs: 200 }] })).toEqual({
                inMs: 200,
                outMs: 800,
            });
        });

        it("takes a lone cue point as the in point", () => {
            expect(normalizeAudioClipRegion({ cuePoints: [{ timeMs: 263_875 }] })).toEqual({ inMs: 263_875 });
        });

        it("never invents a loop point - the old shape had no third marker", () => {
            const region = normalizeAudioClipRegion({ cuePoints: [{ timeMs: 100 }, { timeMs: 400 }, { timeMs: 900 }] });
            expect(region).toEqual({ inMs: 100, outMs: 400 });
            expect(region).not.toHaveProperty("loopStartMs");
        });

        it("defers to the current shape when both are present", () => {
            expect(
                normalizeAudioClipRegion({
                    audioLoop: { inMs: 1, outMs: 3, loopStartMs: 2 },
                    cuePoints: [{ timeMs: 999 }],
                }),
            ).toEqual({ inMs: 1, outMs: 3, loopStartMs: 2 });
        });

        it("is not consulted when a loop point alone was stored under the current shape", () => {
            expect(normalizeAudioClipRegion({ audioLoop: { loopStartMs: 500 }, cuePoints: [{ timeMs: 999 }] })).toEqual({
                loopStartMs: 500,
            });
        });
    });
});

describe("clipSoundConfig", () => {
    const once = { volume: 1, loop: false };
    const looping = { volume: 1, loop: true };

    it("seeks to the head when there is no region", () => {
        expect(clipSoundConfig(null, looping)).toEqual({ volume: 1, seek: 0 });
        expect(clipSoundConfig(undefined, once)).toEqual({ volume: 1, seek: 0 });
    });

    it("converts milliseconds to seconds", () => {
        expect(clipSoundConfig({ inMs: 2400, outMs: 4960 }, looping)).toEqual({ volume: 1, seek: 2.4, endTime: 4.96 });
    });

    it("leaves endTime off entirely for a clip that plays once with no out point", () => {
        const config = clipSoundConfig({ inMs: 2400 }, once);
        expect(config).toEqual({ volume: 1, seek: 2.4 });
        expect(config).not.toHaveProperty("endTime");
    });

    it("emits loopStart for an intro→loop", () => {
        expect(clipSoundConfig({ inMs: 0, outMs: 84_000, loopStartMs: 12_000 }, looping)).toEqual({
            volume: 1,
            seek: 0,
            endTime: 84,
            loopStart: 12,
        });
    });

    describe("a looping clip with no out point", () => {
        /**
         * The engine drops a loop point with no end time beside it and streams the clip through an
         * element that loops from 0:00. The end of the file is the end time the author meant, and
         * the buffer source clamps one past its buffer to that end - so the config says "past the
         * end" and needs no measured length. Before, it carried one only for a clip whose preview had
         * been opened.
         */
        it("turns around at the end of the file, from the loop point", () => {
            expect(clipSoundConfig({ inMs: 500, loopStartMs: 12_000 }, looping)).toEqual({
                volume: 1,
                seek: 0.5,
                endTime: LOOP_TO_END_OF_FILE_SECONDS,
                loopStart: 12,
            });
            expect(clipSoundConfig({ loopStartMs: 12_000 }, looping)).toEqual({
                volume: 1,
                seek: 0,
                endTime: LOOP_TO_END_OF_FILE_SECONDS,
                loopStart: 12,
            });
        });

        it("turns around at the end of the file, from the in point", () => {
            expect(clipSoundConfig({ inMs: 2400 }, looping)).toEqual({
                volume: 1,
                seek: 2.4,
                endTime: LOOP_TO_END_OF_FILE_SECONDS,
            });
        });

        it("is past the end of any clip a game ships", () => {
            expect(LOOP_TO_END_OF_FILE_SECONDS).toBeGreaterThanOrEqual(24 * 60 * 60);
        });

        it("stays a plain whole-file loop when it turns around at the head", () => {
            // No end time keeps the streamed playback the engine gives a whole-file loop.
            expect(clipSoundConfig({ inMs: 0 }, looping)).toEqual({ volume: 1, seek: 0 });
            expect(clipSoundConfig({ inMs: 0, loopStartMs: 0 }, looping)).toEqual({ volume: 1, seek: 0 });
            expect(clipSoundConfig({ gainDb: -6 }, looping)).not.toHaveProperty("endTime");
        });

        it("never replaces an out point the author marked", () => {
            expect(clipSoundConfig({ inMs: 500, outMs: 60_000, loopStartMs: 12_000 }, looping)).toEqual({
                volume: 1,
                seek: 0.5,
                endTime: 60,
                loopStart: 12,
            });
        });

        it("needs nothing but the markers, so a stored length from an earlier build changes nothing", () => {
            const stored = { audioLoop: { inMs: 1000, loopStartMs: 5000, fileLength: { ms: 90_000, hash: "h1" } } };
            const region = normalizeAudioClipRegion(stored);
            expect(region).toEqual({ inMs: 1000, loopStartMs: 5000 });
            expect(clipSoundConfig(region, looping)).toEqual({
                volume: 1,
                seek: 1,
                endTime: LOOP_TO_END_OF_FILE_SECONDS,
                loopStart: 5,
            });
        });
    });

    describe("byte-for-byte compatibility with the two-marker era", () => {
        it("produces exactly the old output when the loop point is absent", () => {
            expect(clipSoundConfig({ inMs: 100, outMs: 900 }, looping)).toEqual({ volume: 1, seek: 0.1, endTime: 0.9 });
            expect(clipSoundConfig({ outMs: 900 }, looping)).toEqual({ volume: 1, seek: 0, endTime: 0.9 });
            expect(clipSoundConfig({ inMs: 100 }, once)).toEqual({ volume: 1, seek: 0.1 });
            for (const region of [{ inMs: 100, outMs: 900 }, { outMs: 900 }, { inMs: 100 }, {}]) {
                expect(clipSoundConfig(region, looping)).not.toHaveProperty("loopStart");
            }
        });

        it("omits loopStart when it says the same thing as seek", () => {
            // The engine returns to `seek` by default, so an equal loop point is not a difference
            // worth writing into the config.
            const config = clipSoundConfig({ inMs: 2400, outMs: 4960, loopStartMs: 2400 }, looping);
            expect(config).toEqual({ volume: 1, seek: 2.4, endTime: 4.96 });
            expect(config).not.toHaveProperty("loopStart");
        });

        it("omits loopStart when it is zero and the in point is unmarked", () => {
            const config = clipSoundConfig({ outMs: 4960, loopStartMs: 0 }, looping);
            expect(config).toEqual({ volume: 1, seek: 0, endTime: 4.96 });
            expect(config).not.toHaveProperty("loopStart");
        });
    });

    it("survives the round trip from a stored record", () => {
        const stored = { audioLoop: { inMs: 1500, outMs: 96_000, loopStartMs: 18_500 } };
        expect(clipSoundConfig(normalizeAudioClipRegion(stored), looping)).toEqual({
            volume: 1,
            seek: 1.5,
            endTime: 96,
            loopStart: 18.5,
        });
    });

    it("degrades to a plain loop when the stored loop point was out of window", () => {
        const stored = { audioLoop: { inMs: 1500, outMs: 96_000, loopStartMs: 120_000 } };
        expect(clipSoundConfig(normalizeAudioClipRegion(stored), looping)).toEqual({ volume: 1, seek: 1.5, endTime: 96 });
    });

    it("carries the caller's volume with the clip's gain folded in", () => {
        expect(clipSoundConfig(null, { volume: 0.8, loop: false }).volume).toBe(0.8);
        expect(clipSoundConfig({ gainDb: -6 }, { volume: 0.8, loop: false }).volume).toBeCloseTo(0.8 * Math.pow(10, -6 / 20), 9);
    });
});

describe("the clip gain", () => {
    it("is read, clamped to what the engine can play, and dropped at unity", () => {
        expect(normalizeAudioClipRegion({ audioGain: { db: -6 } })).toEqual({ gainDb: -6 });
        expect(normalizeAudioClipRegion({ audioGain: { db: 4 } })).toBeNull();
        expect(normalizeAudioClipRegion({ audioGain: { db: -120 } })).toEqual({ gainDb: -60 });
        expect(normalizeAudioClipRegion({ audioGain: { db: "loud" } })).toBeNull();
        // An earlier build stored the loudness the gain was aligned to beside it; only the gain plays.
        expect(normalizeAudioClipRegion({ audioGain: { db: -6, targetLufs: -16 } })).toEqual({ gainDb: -6 });
    });

    it("is not a marker: a clip with only a gain still plays whole", () => {
        const region = normalizeAudioClipRegion({ audioGain: { db: -6 } });
        expect(hasClipMarkers(region)).toBe(false);
        expect(clipSoundConfig(region, { volume: 1, loop: true })).toEqual({ volume: Math.pow(10, -6 / 20), seek: 0 });
    });

    describe("clipVolume", () => {
        it("folds the gain into a volume", () => {
            expect(clipVolume({ gainDb: -6 }, 0.8)).toBeCloseTo(0.8 * 0.501, 3);
            expect(clipVolume({ gainDb: -20 }, 1)).toBeCloseTo(0.1, 6);
            // The volume defaults to unity: the clip's own level, as a voice take plays it.
            expect(clipVolume({ gainDb: -20 })).toBeCloseTo(0.1, 6);
        });

        it("returns the volume untouched for a clip with no gain", () => {
            expect(clipVolume(undefined, 0.8)).toBe(0.8);
            expect(clipVolume(null, 0.35)).toBe(0.35);
            expect(clipVolume({ inMs: 100 }, 0.35)).toBe(0.35);
        });

        it("never raises a clip, whatever the table says", () => {
            expect(clipVolume({ gainDb: 6 }, 0.5)).toBe(0.5);
            expect(clipVolume({ gainDb: Number.NaN }, 0.5)).toBe(0.5);
            expect(clipVolume({ gainDb: -500 }, 1)).toBeCloseTo(Math.pow(10, AUDIO_GAIN_MIN_DB / 20), 9);
        });
    });
});
