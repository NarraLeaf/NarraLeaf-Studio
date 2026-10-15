import { describe, expect, it } from "vitest";
import { musicSummary, type MusicSummaryInput } from "./musicSummary";

/** Echoes a key with its arguments, so the test reads which phrase was chosen and with what. */
const t = ((key: string, args?: Record<string, unknown>) =>
    args ? `${key}(${Object.entries(args).map(([name, value]) => `${name}=${value}`).join(",")})` : key) as never;

const base: MusicSummaryInput = { volume: 1, trackName: "Music", loops: true, region: null, fadeMs: 0 };
const playback = (input: Partial<MusicSummaryInput>) => musicSummary(t, { ...base, ...input }).split(" · ")[1];

describe("music summary", () => {
    it("opens as an element sound's line does, volume then track", () => {
        expect(musicSummary(t, { ...base, volume: 0.6 }).split(" · ")[0])
            .toBe("properties.interactionSound.summary(volume=0.6,track=Music)");
    });

    it("states the volume as stored, 0 to 1, never as a percentage", () => {
        expect(musicSummary(t, { ...base, volume: 0.8 })).toContain("volume=0.8,");
        expect(musicSummary(t, { ...base, volume: 0.55 })).toContain("volume=0.55,");
        expect(musicSummary(t, { ...base, volume: 1 })).toContain("volume=1,");
        expect(musicSummary(t, { ...base, volume: 0 })).toContain("volume=0,");
    });

    it("says a clip with no marks loops whole", () => {
        expect(playback({})).toBe("properties.music.loops");
    });

    it("says what repeats when the clip has a loop point and an out point, the intro before it implied", () => {
        expect(playback({ region: { loopStartMs: 12800, outMs: 112000 } })).toBe("properties.music.loopRegion(from=12.8,to=112)");
    });

    it("loops from the in point when there is no loop point", () => {
        expect(playback({ region: { inMs: 2000, outMs: 60000 } })).toBe("properties.music.loopRegion(from=2,to=60)");
    });

    it("says a loop point with no out point repeats to the end of the file", () => {
        expect(playback({ region: { loopStartMs: 12800 } })).toBe("properties.music.loopToEnd(from=12.8)");
    });

    it("says an in point with no out point repeats from there to the end of the file", () => {
        expect(playback({ region: { inMs: 2000 } })).toBe("properties.music.loopToEnd(from=2)");
    });

    it("names where playback starts when an intro starts past the head of the file", () => {
        expect(playback({ region: { inMs: 2000, loopStartMs: 12800, outMs: 112000 } }))
            .toBe("properties.music.introLoopRegion(start=2,from=12.8,to=112)");
        expect(playback({ region: { inMs: 2000, loopStartMs: 12800 } }))
            .toBe("properties.music.introLoopToEnd(start=2,from=12.8)");
    });

    it("says a clip that only carries a gain loops whole", () => {
        expect(playback({ region: { gainDb: -3 } })).toBe("properties.music.loops");
    });

    it("says music that does not loop plays once, from its in point to its out point", () => {
        expect(playback({ loops: false })).toBe("properties.music.once");
        // A loop point only decides where a repeat starts, and there is no repeat.
        expect(playback({ loops: false, region: { loopStartMs: 12800 } })).toBe("properties.music.once");
        expect(playback({ loops: false, region: { inMs: 2000 } })).toBe("properties.music.onceFrom(from=2)");
        expect(playback({ loops: false, region: { loopStartMs: 12800, outMs: 112000 } }))
            .toBe("properties.music.onceRegion(from=0,to=112)");
        expect(playback({ loops: false, region: { inMs: 2000, outMs: 60000 } }))
            .toBe("properties.music.onceRegion(from=2,to=60)");
    });

    it("names a fade only when there is one", () => {
        expect(musicSummary(t, base).split(" · ")).toHaveLength(2);
        expect(musicSummary(t, { ...base, fadeMs: 1200 }).split(" · ")[2]).toBe("properties.music.fadeSummary(seconds=1.2)");
        expect(musicSummary(t, { ...base, fadeMs: 2000 }).split(" · ")[2]).toBe("properties.music.fadeSummary(seconds=2)");
    });
});
