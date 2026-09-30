import { describe, expect, it } from "vitest";
import { alignedGainDb, clampGainDb, gainFromAssetExtras, LOUDNESS_TARGET_LUFS, toAssetGain } from "./clipGain";

describe("alignedGainDb", () => {
    it("turns a loud clip down to Studio's loudness target", () => {
        expect(LOUDNESS_TARGET_LUFS).toBe(-16);
        expect(alignedGainDb(-9.4)).toBe(-6.6);
    });

    it("leaves a clip already quieter than the target at unity", () => {
        // Raising it is the one thing the game cannot do, so no gain is promised.
        expect(alignedGainDb(-20)).toBe(0);
    });
});

describe("clampGainDb", () => {
    it("never goes above unity or below the floor, and rounds to a tenth", () => {
        expect(clampGainDb(3)).toBe(0);
        expect(clampGainDb(-200)).toBe(-60);
        expect(clampGainDb(-6.66)).toBe(-6.7);
        expect(Object.is(clampGainDb(-0.01), 0)).toBe(true);
    });
});

describe("stored gain", () => {
    it("round-trips, and leaves the record at unity", () => {
        expect(gainFromAssetExtras({ audioGain: toAssetGain(-6.6) })).toBe(-6.6);
        expect(toAssetGain(0)).toBeUndefined();
        expect(gainFromAssetExtras({})).toBe(0);
    });

    it("reads the gain alone from a record that also stored the loudness it was aligned to", () => {
        // An earlier build wrote the target beside the gain; only the gain plays.
        const extras = { audioGain: { db: -4, targetLufs: -18 } } as never;
        expect(gainFromAssetExtras(extras)).toBe(-4);
    });
});
