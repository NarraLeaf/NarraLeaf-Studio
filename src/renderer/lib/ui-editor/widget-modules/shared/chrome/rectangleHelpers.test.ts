import { describe, expect, it } from "vitest";
import {
    computeContainCropPlacement,
    computeCoverCropPlacement,
    computeCropPlacementForMode,
    getRectangleLikeProps,
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

/**
 * `element.props` is whatever the document on disk holds, so this narrowing is the last thing
 * between a hand-edit and a renderer with no branch for the value it is handed. It was a blind
 * `as` cast until gradients arrived - an unknown string flowed straight through it and only failed
 * further downstream - so the point of these is that the list stays complete.
 */
describe("rectangle fill type and gradient reading", () => {
    it("reads each fill kind the widget can paint", () => {
        for (const fillType of ["color", "image", "gradient"]) {
            expect(getRectangleLikeProps({ props: { fillType } }).fillType, fillType).toBe(fillType);
        }
    });

    it("falls back to a colour for a kind this build cannot paint", () => {
        expect(getRectangleLikeProps({ props: { fillType: "mesh" } }).fillType).toBe("color");
        expect(getRectangleLikeProps({ props: {} }).fillType).toBe("color");
    });

    it("carries a stored gradient through, repaired", () => {
        const props = getRectangleLikeProps({
            props: {
                fillType: "gradient",
                gradientFill: {
                    kind: "linear",
                    stops: [
                        { offset: 2, color: "#ffffff" },
                        { offset: -1, color: "nlbrand:primary" },
                    ],
                },
            },
        });

        expect(props.gradientFill?.stops).toEqual([
            { offset: 0, color: "nlbrand:primary" },
            { offset: 1, color: "#ffffff" },
        ]);
    });

    it("drops a gradient with no honest reading rather than inventing one", () => {
        expect(
            getRectangleLikeProps({ props: { gradientFill: { kind: "mesh", stops: [] } } }).gradientFill,
        ).toBeUndefined();
    });
});
