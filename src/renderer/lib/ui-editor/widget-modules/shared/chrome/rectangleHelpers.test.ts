import { describe, expect, it } from "vitest";
import {
    computeContainCropPlacement,
    computeCoverCropPlacement,
    computeCropPlacementForMode,
} from "./rectangleHelpers";

describe("rectangle image crop placement helpers", () => {
    it("converts cover into an oversized centered crop box", () => {
        expect(
            computeCoverCropPlacement({
                imageWidth: 400,
                imageHeight: 200,
                containerWidth: 100,
                containerHeight: 100,
            }),
        ).toEqual({
            leftPct: -50,
            topPct: 0,
            widthPct: 200,
            heightPct: 100,
        });
    });

    it("converts contain into a fitted centered crop box without stretching", () => {
        expect(
            computeContainCropPlacement({
                imageWidth: 400,
                imageHeight: 200,
                containerWidth: 100,
                containerHeight: 100,
            }),
        ).toEqual({
            leftPct: 0,
            topPct: 25,
            widthPct: 100,
            heightPct: 50,
        });
    });

    it("uses stretch placement only for stretch-like modes", () => {
        expect(
            computeCropPlacementForMode({
                imageWidth: 400,
                imageHeight: 200,
                containerWidth: 100,
                containerHeight: 100,
                mode: "stretch",
            }),
        ).toEqual({
            leftPct: 0,
            topPct: 0,
            widthPct: 100,
            heightPct: 100,
        });
    });
});
