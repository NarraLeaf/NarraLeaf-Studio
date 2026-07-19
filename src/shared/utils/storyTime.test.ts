import { describe, expect, it } from "vitest";
import { formatStorySecondsLabel, formatStorySecondsValue, storyMsToSeconds, storySecondsToMs } from "./storyTime";

describe("storyTime", () => {
    it("converts author seconds to stored milliseconds", () => {
        expect(storySecondsToMs(1)).toBe(1000);
        expect(storySecondsToMs(0.3)).toBe(300);
        expect(storySecondsToMs(0)).toBe(0);
    });

    it("rounds sub-millisecond seconds to whole milliseconds", () => {
        expect(storySecondsToMs(0.0004)).toBe(0);
        expect(storySecondsToMs(0.0006)).toBe(1);
        expect(storySecondsToMs(0.4205)).toBe(421);
    });

    it("keeps float noise out of the stored value", () => {
        // 0.1 * 1000 === 100.00000000000001 without the rounding step.
        expect(storySecondsToMs(0.1)).toBe(100);
        expect(Number.isInteger(storySecondsToMs(0.29))).toBe(true);
    });

    it("converts stored milliseconds to author seconds", () => {
        expect(storyMsToSeconds(1000)).toBe(1);
        expect(storyMsToSeconds(250)).toBe(0.25);
        expect(storyMsToSeconds(420)).toBe(0.42);
        expect(storyMsToSeconds(0)).toBe(0);
    });

    it("round-trips the ms defaults the editor ships", () => {
        for (const ms of [180, 250, 300, 420, 600, 1000]) {
            expect(storySecondsToMs(storyMsToSeconds(ms))).toBe(ms);
        }
    });

    it("formats a committed display value without a unit", () => {
        expect(formatStorySecondsValue(500)).toBe("0.5");
        expect(formatStorySecondsValue(1000)).toBe("1");
        expect(formatStorySecondsValue(0)).toBe("0");
    });

    it("formats absent values as an empty display", () => {
        expect(formatStorySecondsValue(undefined)).toBe("");
        expect(formatStorySecondsValue(null)).toBe("");
        expect(formatStorySecondsValue(Number.NaN)).toBe("");
        expect(formatStorySecondsValue(Number.POSITIVE_INFINITY)).toBe("");
    });

    it("labels summaries with a seconds suffix", () => {
        expect(formatStorySecondsLabel(500)).toBe("0.5s");
        expect(formatStorySecondsLabel(1000)).toBe("1s");
        expect(formatStorySecondsLabel(0)).toBe("0s");
    });

    it("labels absent values as zero rather than a bare suffix", () => {
        expect(formatStorySecondsLabel(undefined)).toBe("0s");
    });
});
