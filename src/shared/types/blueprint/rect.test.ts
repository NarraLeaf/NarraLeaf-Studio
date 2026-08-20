import { describe, expect, it } from "vitest";
import { blueprintRectCenter, normalizeBlueprintRect, normalizeRectExtent } from "./valueTypes";

describe("normalizeRectExtent", () => {
    it("leaves an ordinary rect alone", () => {
        expect(normalizeRectExtent(10, 20, 30, 40)).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    });

    it("folds a negative extent into the origin so x + width is always the right edge", () => {
        // A widget dragged past its own origin is stored this way. Both spellings cover the same
        // area, and a consumer must not have to ask which corner it was handed.
        expect(normalizeRectExtent(40, 60, -30, -40)).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    });
});

describe("normalizeBlueprintRect", () => {
    it("reads the four fields off any object", () => {
        expect(normalizeBlueprintRect({ x: 1, y: 2, width: 3, height: 4, extra: 5 })).toEqual({
            x: 1,
            y: 2,
            width: 3,
            height: 4,
        });
    });

    it("treats a missing or unreadable field as zero", () => {
        expect(normalizeBlueprintRect({ x: "nope", height: 4 })).toEqual({ x: 0, y: 0, width: 0, height: 4 });
        expect(normalizeBlueprintRect(null)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });
});

describe("blueprintRectCenter", () => {
    it("is equidistant from all four edges", () => {
        expect(blueprintRectCenter({ x: 10, y: 20, width: 30, height: 40 })).toEqual({ x: 25, y: 40 });
    });
});
