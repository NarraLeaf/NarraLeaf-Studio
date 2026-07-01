import { describe, expect, it } from "vitest";
import { constrainPointToAspectRatio, resolveAspectRatio } from "./insertAspectRatio";

describe("insertAspectRatio", () => {
    it("resolves a valid width-to-height ratio", () => {
        expect(resolveAspectRatio(320, 160)).toBe(2);
        expect(resolveAspectRatio(-300, 100)).toBe(3);
    });

    it("ignores missing or unusable source sizes", () => {
        expect(resolveAspectRatio(0, 100)).toBeNull();
        expect(resolveAspectRatio(100, 0)).toBeNull();
        expect(resolveAspectRatio(Number.NaN, 100)).toBeNull();
    });

    it("locks horizontal-dominant drags by deriving height from width", () => {
        expect(constrainPointToAspectRatio({ x: 10, y: 20 }, { x: 210, y: 50 }, 2)).toEqual({
            x: 210,
            y: 120,
        });
    });

    it("locks vertical-dominant drags by deriving width from height", () => {
        expect(constrainPointToAspectRatio({ x: 10, y: 20 }, { x: 60, y: 220 }, 2)).toEqual({
            x: 410,
            y: 220,
        });
    });

    it("preserves reverse drag direction", () => {
        expect(constrainPointToAspectRatio({ x: 200, y: 200 }, { x: 100, y: 170 }, 2)).toEqual({
            x: 100,
            y: 150,
        });
    });
});
