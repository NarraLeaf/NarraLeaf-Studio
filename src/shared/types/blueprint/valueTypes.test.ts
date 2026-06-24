import { describe, expect, it } from "vitest";
import {
    blueprintRGBAColorToRgbaHex,
    normalizeBlueprintRGBAColor,
} from "./valueTypes";

describe("blueprint value types", () => {
    it("normalizes and formats RGBA colors as 8-character hex", () => {
        expect(normalizeBlueprintRGBAColor("#10203080")).toEqual({
            r: 16,
            g: 32,
            b: 48,
            a: 128 / 255,
        });
        expect(blueprintRGBAColorToRgbaHex({ r: 16, g: 32, b: 48, a: 0.5 })).toBe("10203080");
    });
});
