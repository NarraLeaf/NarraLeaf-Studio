import { describe, expect, it } from "vitest";
import {
    alignedGain,
    clampGainDb,
    DEFAULT_TARGET_LUFS,
    gainFromAssetExtras,
    projectTargetLufs,
    storedLengthIsStale,
    toAssetGain,
    toStoredRegion,
} from "./clipGain";
import { EMPTY_LOOP } from "./loopHistory";

const FILE = { lengthMs: 262_287, hash: "abc" };

describe("alignedGain", () => {
    it("turns a loud clip down to the target", () => {
        expect(alignedGain(-9.4, -16)).toEqual({ db: -6.6, targetLufs: -16 });
    });

    it("leaves a clip already quieter than the target at unity", () => {
        // Raising it is the one thing the game cannot do, so no gain is promised.
        expect(alignedGain(-20, -16)).toEqual({ db: 0, targetLufs: null });
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
        const gain = { db: -6.6, targetLufs: -16 };
        expect(gainFromAssetExtras({ audioGain: toAssetGain(gain) })).toEqual(gain);
        expect(toAssetGain({ db: 0, targetLufs: null })).toBeUndefined();
        expect(gainFromAssetExtras({})).toEqual({ db: 0, targetLufs: null });
    });
});

describe("projectTargetLufs", () => {
    it("offers the target most of the project's clips were aligned to", () => {
        expect(projectTargetLufs([
            { audioGain: { db: -3, targetLufs: -18 } },
            { audioGain: { db: -5, targetLufs: -16 } },
            { audioGain: { db: -2, targetLufs: -16 } },
            { audioGain: { db: -4 } },
            undefined,
        ])).toBe(-16);
    });

    it("breaks a tie towards the quieter target, and defaults when nothing was aligned", () => {
        expect(projectTargetLufs([
            { audioGain: { db: -3, targetLufs: -14 } },
            { audioGain: { db: -3, targetLufs: -18 } },
        ])).toBe(-18);
        expect(projectTargetLufs([])).toBe(DEFAULT_TARGET_LUFS);
    });
});

describe("toStoredRegion", () => {
    it("records the file length only for markers that end at the end of the file", () => {
        expect(toStoredRegion({ inMs: 1000, loopStartMs: 5000, outMs: null }, FILE)).toEqual({
            inMs: 1000,
            loopStartMs: 5000,
            fileLength: { ms: 262_287, hash: "abc" },
        });
        expect(toStoredRegion({ inMs: 1000, loopStartMs: null, outMs: 9000 }, FILE)).toEqual({ inMs: 1000, outMs: 9000 });
        expect(toStoredRegion(EMPTY_LOOP, FILE)).toBeUndefined();
    });

    it("stores the markers alone before the file has been measured", () => {
        expect(toStoredRegion({ inMs: 1000, loopStartMs: null, outMs: null }, null)).toEqual({ inMs: 1000 });
    });
});

describe("storedLengthIsStale", () => {
    const loop = { inMs: 1000, loopStartMs: null, outMs: null };

    it("asks for a length the markers need but the record lacks", () => {
        expect(storedLengthIsStale({ inMs: 1000 }, loop, FILE)).toBe(true);
    });

    it("asks again once the file has been replaced", () => {
        expect(storedLengthIsStale({ inMs: 1000, fileLength: { ms: 262_287, hash: "old" } }, loop, FILE)).toBe(true);
        expect(storedLengthIsStale({ inMs: 1000, fileLength: { ms: 262_287, hash: "abc" } }, loop, FILE)).toBe(false);
    });

    it("has nothing to ask for markers that end at an out point, or for none", () => {
        expect(storedLengthIsStale({ inMs: 1000, outMs: 9000 }, { ...loop, outMs: 9000 }, FILE)).toBe(false);
        expect(storedLengthIsStale(undefined, EMPTY_LOOP, FILE)).toBe(false);
    });
});
