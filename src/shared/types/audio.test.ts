import { describe, expect, it } from "vitest";
import { audioClipRegionToSoundConfig, normalizeAudioClipRegion } from "./audio";

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
      outMs: 900
    });
    expect(
      normalizeAudioClipRegion({ audioLoop: { inMs: 0, outMs: 900, loopStartMs: 400 } })
    ).toEqual({
      inMs: 0,
      outMs: 900,
      loopStartMs: 400
    });
  });

  it("keeps each marker on its own", () => {
    expect(normalizeAudioClipRegion({ audioLoop: { inMs: 100 } })).toEqual({ inMs: 100 });
    expect(normalizeAudioClipRegion({ audioLoop: { outMs: 900 } })).toEqual({ outMs: 900 });
    // A lone loop point is a whole-file clip that returns to a spot partway in - the classic
    // single-file intro→loop with no trimming at either end.
    expect(normalizeAudioClipRegion({ audioLoop: { loopStartMs: 900 } })).toEqual({
      loopStartMs: 900
    });
  });

  it("rejects values that are not finite non-negative numbers", () => {
    expect(normalizeAudioClipRegion({ audioLoop: { inMs: -1, outMs: 900 } })).toEqual({
      outMs: 900
    });
    expect(normalizeAudioClipRegion({ audioLoop: { inMs: "100", outMs: 900 } })).toEqual({
      outMs: 900
    });
    expect(normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: Number.NaN } })).toEqual({
      inMs: 100
    });
    expect(
      normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900, loopStartMs: -5 } })
    ).toEqual({
      inMs: 100,
      outMs: 900
    });
    expect(
      normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900, loopStartMs: Infinity } })
    ).toEqual({
      inMs: 100,
      outMs: 900
    });
  });

  it("drops an out point that does not sit after the in point", () => {
    expect(normalizeAudioClipRegion({ audioLoop: { inMs: 900, outMs: 100 } })).toEqual({
      inMs: 900
    });
    expect(normalizeAudioClipRegion({ audioLoop: { inMs: 900, outMs: 900 } })).toEqual({
      inMs: 900
    });
  });

  describe("the loop point's window", () => {
    it("accepts a loop point sitting on the in point", () => {
      expect(
        normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900, loopStartMs: 100 } })
      ).toEqual({
        inMs: 100,
        outMs: 900,
        loopStartMs: 100
      });
    });

    it("accepts a loop point inside the region", () => {
      expect(
        normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900, loopStartMs: 899 } })
      ).toEqual({
        inMs: 100,
        outMs: 900,
        loopStartMs: 899
      });
    });

    it("drops a loop point before the in point rather than clamping it there", () => {
      expect(
        normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900, loopStartMs: 99 } })
      ).toEqual({
        inMs: 100,
        outMs: 900
      });
    });

    it("drops a loop point at or past the out point", () => {
      expect(
        normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900, loopStartMs: 900 } })
      ).toEqual({
        inMs: 100,
        outMs: 900
      });
      expect(
        normalizeAudioClipRegion({ audioLoop: { inMs: 100, outMs: 900, loopStartMs: 1200 } })
      ).toEqual({
        inMs: 100,
        outMs: 900
      });
    });

    it("leaves an unmarked end open rather than treating it as a bound", () => {
      // No in point: the window starts at the head of the file.
      expect(normalizeAudioClipRegion({ audioLoop: { outMs: 900, loopStartMs: 400 } })).toEqual({
        outMs: 900,
        loopStartMs: 400
      });
      // No out point: the window runs to the tail of the file.
      expect(normalizeAudioClipRegion({ audioLoop: { inMs: 100, loopStartMs: 40_000 } })).toEqual({
        inMs: 100,
        loopStartMs: 40_000
      });
    });

    it("re-checks the window against the out point that survived, not the one that was stored", () => {
      // The out point is dropped for sitting before the in point; the loop point then has
      // only the in point to satisfy, and does.
      expect(
        normalizeAudioClipRegion({ audioLoop: { inMs: 900, outMs: 100, loopStartMs: 950 } })
      ).toEqual({
        inMs: 900,
        loopStartMs: 950
      });
    });

    it("drops the loop point when it is the only marker left standing outside the window", () => {
      expect(
        normalizeAudioClipRegion({ audioLoop: { inMs: 900, outMs: 100, loopStartMs: 500 } })
      ).toEqual({
        inMs: 900
      });
    });
  });

  describe("the superseded cue-point list", () => {
    it("reads the earliest two markers as in and out", () => {
      expect(normalizeAudioClipRegion({ cuePoints: [{ timeMs: 800 }, { timeMs: 200 }] })).toEqual({
        inMs: 200,
        outMs: 800
      });
    });

    it("takes a lone cue point as the in point", () => {
      expect(normalizeAudioClipRegion({ cuePoints: [{ timeMs: 263_875 }] })).toEqual({
        inMs: 263_875
      });
    });

    it("never invents a loop point - the old shape had no third marker", () => {
      const region = normalizeAudioClipRegion({
        cuePoints: [{ timeMs: 100 }, { timeMs: 400 }, { timeMs: 900 }]
      });
      expect(region).toEqual({ inMs: 100, outMs: 400 });
      expect(region).not.toHaveProperty("loopStartMs");
    });

    it("defers to the current shape when both are present", () => {
      expect(
        normalizeAudioClipRegion({
          audioLoop: { inMs: 1, outMs: 3, loopStartMs: 2 },
          cuePoints: [{ timeMs: 999 }]
        })
      ).toEqual({ inMs: 1, outMs: 3, loopStartMs: 2 });
    });

    it("is not consulted when a loop point alone was stored under the current shape", () => {
      expect(
        normalizeAudioClipRegion({ audioLoop: { loopStartMs: 500 }, cuePoints: [{ timeMs: 999 }] })
      ).toEqual({
        loopStartMs: 500
      });
    });
  });
});

describe("audioClipRegionToSoundConfig", () => {
  it("seeks to the head when there is no region", () => {
    expect(audioClipRegionToSoundConfig(null)).toEqual({ seek: 0 });
    expect(audioClipRegionToSoundConfig(undefined)).toEqual({ seek: 0 });
  });

  it("converts milliseconds to seconds", () => {
    expect(audioClipRegionToSoundConfig({ inMs: 2400, outMs: 4960 })).toEqual({
      seek: 2.4,
      endTime: 4.96
    });
  });

  it("leaves endTime off entirely when the out point is unmarked", () => {
    const config = audioClipRegionToSoundConfig({ inMs: 2400 });
    expect(config).toEqual({ seek: 2.4 });
    expect(config).not.toHaveProperty("endTime");
  });

  it("emits loopStart for an intro→loop", () => {
    expect(audioClipRegionToSoundConfig({ inMs: 0, outMs: 84_000, loopStartMs: 12_000 })).toEqual({
      seek: 0,
      endTime: 84,
      loopStart: 12
    });
  });

  it("emits loopStart with no out point too - the file's tail is the turnaround", () => {
    expect(audioClipRegionToSoundConfig({ inMs: 500, loopStartMs: 12_000 })).toEqual({
      seek: 0.5,
      loopStart: 12
    });
  });

  describe("byte-for-byte compatibility with the two-marker era", () => {
    it("produces exactly the old output when the loop point is absent", () => {
      expect(audioClipRegionToSoundConfig({ inMs: 100, outMs: 900 })).toEqual({
        seek: 0.1,
        endTime: 0.9
      });
      expect(audioClipRegionToSoundConfig({ outMs: 900 })).toEqual({ seek: 0, endTime: 0.9 });
      expect(audioClipRegionToSoundConfig({ inMs: 100 })).toEqual({ seek: 0.1 });
      for (const region of [{ inMs: 100, outMs: 900 }, { outMs: 900 }, { inMs: 100 }, {}]) {
        expect(audioClipRegionToSoundConfig(region)).not.toHaveProperty("loopStart");
      }
    });

    it("omits loopStart when it says the same thing as seek", () => {
      // The engine returns to `seek` by default, so an equal loop point is not a difference
      // worth writing into the config.
      const config = audioClipRegionToSoundConfig({ inMs: 2400, outMs: 4960, loopStartMs: 2400 });
      expect(config).toEqual({ seek: 2.4, endTime: 4.96 });
      expect(config).not.toHaveProperty("loopStart");
    });

    it("omits loopStart when it is zero and the in point is unmarked", () => {
      const config = audioClipRegionToSoundConfig({ outMs: 4960, loopStartMs: 0 });
      expect(config).toEqual({ seek: 0, endTime: 4.96 });
      expect(config).not.toHaveProperty("loopStart");
    });
  });

  it("survives the round trip from a stored record", () => {
    const stored = { audioLoop: { inMs: 1500, outMs: 96_000, loopStartMs: 18_500 } };
    expect(audioClipRegionToSoundConfig(normalizeAudioClipRegion(stored))).toEqual({
      seek: 1.5,
      endTime: 96,
      loopStart: 18.5
    });
  });

  it("degrades to a plain loop when the stored loop point was out of window", () => {
    const stored = { audioLoop: { inMs: 1500, outMs: 96_000, loopStartMs: 120_000 } };
    expect(audioClipRegionToSoundConfig(normalizeAudioClipRegion(stored))).toEqual({
      seek: 1.5,
      endTime: 96
    });
  });
});
