import { describe, expect, it } from "vitest";
import {
    clampFontSizeStep,
    fontScaleForStep,
    isStoryTextEmphasis,
    STORY_TEXT_EMPHASIS_VALUES,
    storyEmphasisToWordConfig,
    storyMarksToWordConfig,
} from "./storyTextMarks";

describe("storyTextMarks", () => {
    it("names four conventions and nothing else", () => {
        expect(STORY_TEXT_EMPHASIS_VALUES).toEqual(["dot", "circle", "sesame", "under-dot"]);
        expect(isStoryTextEmphasis("dot")).toBe(true);
        expect(isStoryTextEmphasis("triangle")).toBe(false);
        expect(isStoryTextEmphasis(undefined)).toBe(false);
    });

    it("sets the Chinese convention below the line and the Japanese ones above it", () => {
        expect(storyEmphasisToWordConfig("dot")).toEqual({ mark: "dot", fill: "filled", position: "over" });
        expect(storyEmphasisToWordConfig("circle")).toEqual({ mark: "circle", fill: "open", position: "over" });
        expect(storyEmphasisToWordConfig("sesame")).toEqual({ mark: "sesame", fill: "filled", position: "over" });
        expect(storyEmphasisToWordConfig("under-dot")).toEqual({ mark: "dot", fill: "filled", position: "under" });
    });

    it("reads a step of zero as the size of the line", () => {
        expect(clampFontSizeStep(0)).toBeUndefined();
        expect(clampFontSizeStep("")).toBeUndefined();
        expect(clampFontSizeStep(2.4)).toBe(2);
        expect(clampFontSizeStep(-40)).toBe(-6);
    });

    it("turns a step into a multiplier either side of one", () => {
        expect(fontScaleForStep(0)).toBe(1);
        expect(fontScaleForStep(1)).toBeCloseTo(1.125, 4);
        expect(fontScaleForStep(-1)).toBeCloseTo(0.8889, 4);
        // Symmetric: a run set two steps up and back down again is the size of the line.
        expect(fontScaleForStep(2) * fontScaleForStep(-2)).toBeCloseTo(1, 3);
    });

    it("carries every mark into the engine's word config", () => {
        expect(storyMarksToWordConfig({})).toEqual({});
        expect(storyMarksToWordConfig({
            bold: true,
            italic: true,
            color: "#ff0000",
            ruby: "かのじょ",
            cps: 8,
            emphasis: "dot",
            fontSizeStep: 2,
        })).toEqual({
            bold: true,
            italic: true,
            color: "#ff0000",
            ruby: "かのじょ",
            cps: 8,
            emphasis: { mark: "dot", fill: "filled", position: "over" },
            fontScale: fontScaleForStep(2),
        });
    });

    it("sends a legacy absolute size as an absolute size, alongside any step", () => {
        expect(storyMarksToWordConfig({ fontSize: 32, fontSizeStep: 1 })).toEqual({
            fontSize: 32,
            fontScale: fontScaleForStep(1),
        });
    });
});
