import { describe, expect, it } from "vitest";
import { computeCoverCropPlacement } from "./rectangleHelpers";

describe("computeCoverCropPlacement", () => {
    it("centers a wide image in a tall container", () => {
        expect(
            computeCoverCropPlacement({
                imageWidth: 200,
                imageHeight: 100,
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

    it("centers a tall image in a wide container", () => {
        expect(
            computeCoverCropPlacement({
                imageWidth: 100,
                imageHeight: 200,
                containerWidth: 100,
                containerHeight: 100,
            }),
        ).toEqual({
            leftPct: 0,
            topPct: -50,
            widthPct: 100,
            heightPct: 200,
        });
    });

    it("returns null for invalid dimensions", () => {
        expect(
            computeCoverCropPlacement({
                imageWidth: 0,
                imageHeight: 100,
                containerWidth: 100,
                containerHeight: 100,
            }),
        ).toBeNull();
    });
});
