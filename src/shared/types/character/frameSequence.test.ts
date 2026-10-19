import { describe, expect, it } from "vitest";
import { normalizeFrameSequence } from "./frameSequence";

describe("character frame sequences", () => {
    it("keeps ordered frames and copies their array", () => {
        const input = { frameAssetIds: ["frame-10", "frame-2"], fps: 12, loop: true };
        const normalized = normalizeFrameSequence(input)!;
        expect(normalized).toEqual(input);
        input.frameAssetIds.reverse();
        expect(normalized.frameAssetIds).toEqual(["frame-10", "frame-2"]);
    });

    it("rejects unusable clocks and empty or malformed frame lists", () => {
        for (const fps of [0, -1, Infinity, NaN, 121]) {
            expect(normalizeFrameSequence({ frameAssetIds: ["a"], fps })).toBeUndefined();
        }
        for (const frameAssetIds of [[], [null], [""]]) {
            expect(normalizeFrameSequence({ frameAssetIds, fps: 12 })).toBeUndefined();
        }
        expect(normalizeFrameSequence({ frameAssetIds: ["a"], fps: 12 })).toEqual({
            frameAssetIds: ["a"],
            fps: 12,
            loop: true,
        });
    });
});
