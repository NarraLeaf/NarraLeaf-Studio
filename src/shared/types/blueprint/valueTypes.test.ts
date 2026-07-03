import { describe, expect, it } from "vitest";
import {
    blueprintRGBAColorToRgbaHex,
    normalizeBlueprintAnimationToken,
    normalizeBlueprintTimerToken,
    normalizeBlueprintRGBAColor,
    toBlueprintAnimationToken,
    toBlueprintTimerToken,
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

    it("normalizes Timer tokens", () => {
        expect(toBlueprintTimerToken(" delay:node ")).toEqual({ kind: "timer", id: "delay:node" });
        expect(normalizeBlueprintTimerToken({ kind: "timer", id: "delay:node" })).toEqual({
            kind: "timer",
            id: "delay:node",
        });
        expect(normalizeBlueprintTimerToken({ kind: "timer", id: "" })).toBeNull();
    });

    it("normalizes AnimationToken tokens", () => {
        expect(toBlueprintAnimationToken(" animation:node ")).toEqual({ kind: "animation", id: "animation:node" });
        expect(normalizeBlueprintAnimationToken({ kind: "animation", id: "animation:node" })).toEqual({
            kind: "animation",
            id: "animation:node",
        });
        expect(normalizeBlueprintAnimationToken({ kind: "timer", id: "animation:node" })).toBeNull();
        expect(normalizeBlueprintAnimationToken({ kind: "animation", id: "" })).toBeNull();
    });
});
