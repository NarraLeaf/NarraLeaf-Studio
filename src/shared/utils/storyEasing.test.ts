import { describe, expect, it } from "vitest";
import {
    clampStoryBezierPoints,
    formatStoryBezierEasing,
    isStoryBezierEasing,
    parseStoryEasing,
    storyBezierPoints,
    STORY_DEFAULT_BEZIER_EASING,
} from "./storyEasing";

describe("storyEasing", () => {
    it("passes named easings through", () => {
        expect(parseStoryEasing("easeOut")).toBe("easeOut");
        expect(parseStoryEasing("linear")).toBe("linear");
    });

    it("returns undefined for empty values", () => {
        expect(parseStoryEasing(undefined)).toBeUndefined();
        expect(parseStoryEasing("")).toBeUndefined();
    });

    it("parses cubic-bezier strings into tuples", () => {
        expect(parseStoryEasing("cubic-bezier(0.42, 0, 0.58, 1)")).toEqual([0.42, 0, 0.58, 1]);
        expect(parseStoryEasing("cubic-bezier(0.5,-0.25,0.5,1.25)")).toEqual([0.5, -0.25, 0.5, 1.25]);
        expect(parseStoryEasing("CUBIC-BEZIER(0, 0, 1, 1)")).toEqual([0, 0, 1, 1]);
    });

    it("leaves malformed bezier strings untouched", () => {
        expect(parseStoryEasing("cubic-bezier(0.42, 0, 0.58)")).toBe("cubic-bezier(0.42, 0, 0.58)");
        expect(parseStoryEasing("cubic-bezier(a, b, c, d)")).toBe("cubic-bezier(a, b, c, d)");
    });

    it("formats tuples back to cubic-bezier strings with rounding, and without spaces", () => {
        // No spaces: the story row prints this value as one `ease=` token, and a token carrying
        // spaces has to be quoted to survive the line's tokenizer.
        expect(formatStoryBezierEasing([0.42, 0, 0.58, 1])).toBe("cubic-bezier(0.42,0,0.58,1)");
        expect(formatStoryBezierEasing([0.123456, -0.5, 0.987654, 1.5])).toBe("cubic-bezier(0.12,-0.5,0.99,1.5)");
    });

    it("round-trips what it writes, including the default curve", () => {
        expect(parseStoryEasing(STORY_DEFAULT_BEZIER_EASING)).toEqual([0.42, 0, 0.58, 1]);
        expect(formatStoryBezierEasing(parseStoryEasing("cubic-bezier(0.5, 0.1, 0.5, 0.9)") as number[]))
            .toBe("cubic-bezier(0.5,0.1,0.5,0.9)");
    });

    it("tells a drawn curve apart from a named easing", () => {
        expect(isStoryBezierEasing(STORY_DEFAULT_BEZIER_EASING)).toBe(true);
        expect(isStoryBezierEasing("easeInOut")).toBe(false);
        expect(isStoryBezierEasing(undefined)).toBe(false);
        expect(isStoryBezierEasing("cubic-bezier(a, b, c, d)")).toBe(false);
        expect(storyBezierPoints("cubic-bezier(0.2,0,0.8,1)")).toEqual([0.2, 0, 0.8, 1]);
        expect(storyBezierPoints("linear")).toBeNull();
    });

    it("holds a dragged handle inside the range the curve is drawn in", () => {
        // Time cannot leave the duration; the value may overshoot both ways, which is what an
        // anticipate or a bounce is made of.
        expect(clampStoryBezierPoints([-1, -4, 2, 4])).toEqual([0, -0.5, 1, 1.5]);
        expect(clampStoryBezierPoints([0.3, 1.2, 0.7, -0.2])).toEqual([0.3, 1.2, 0.7, -0.2]);
        expect(clampStoryBezierPoints([Number.NaN, Number.NaN, Number.NaN, Number.NaN])).toEqual([0, -0.5, 0, -0.5]);
    });
});
