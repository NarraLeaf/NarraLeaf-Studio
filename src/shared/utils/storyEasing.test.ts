import { describe, expect, it } from "vitest";
import { formatStoryBezierEasing, parseStoryEasing } from "./storyEasing";

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

    it("formats tuples back to cubic-bezier strings with rounding", () => {
        expect(formatStoryBezierEasing([0.42, 0, 0.58, 1])).toBe("cubic-bezier(0.42, 0, 0.58, 1)");
        expect(formatStoryBezierEasing([0.123456, -0.5, 0.987654, 1.5])).toBe("cubic-bezier(0.12, -0.5, 0.99, 1.5)");
    });
});
