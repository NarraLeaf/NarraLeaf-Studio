import { describe, expect, it } from "vitest";
import { blueprintValuesEqual } from "./blueprintValueEquality";

describe("blueprintValuesEqual", () => {
    it("compares numbers by value and text exactly, and never across kinds", () => {
        expect(blueprintValuesEqual(1, 1.0)).toBe(true);
        expect(blueprintValuesEqual("a", "a")).toBe(true);
        expect(blueprintValuesEqual("a", "A")).toBe(false);
        expect(blueprintValuesEqual(1, "1")).toBe(false);
        expect(blueprintValuesEqual(true, 1)).toBe(false);
        expect(blueprintValuesEqual(0, "")).toBe(false);
    });

    it("reads a missing value, and a number that is not finite, as Null", () => {
        expect(blueprintValuesEqual(undefined, null)).toBe(true);
        expect(blueprintValuesEqual(undefined, undefined)).toBe(true);
        expect(blueprintValuesEqual(Number.NaN, null)).toBe(true);
        expect(blueprintValuesEqual(null, 0)).toBe(false);
        expect(blueprintValuesEqual(null, "")).toBe(false);
        expect(blueprintValuesEqual(null, {})).toBe(false);
    });

    it("compares lists item by item and objects field by field, whatever order the fields are in", () => {
        expect(blueprintValuesEqual([1, "a", [true]], [1, "a", [true]])).toBe(true);
        expect(blueprintValuesEqual([1, 2], [2, 1])).toBe(false);
        expect(blueprintValuesEqual([1], [1, 1])).toBe(false);
        expect(blueprintValuesEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
        expect(blueprintValuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
        expect(blueprintValuesEqual({ a: undefined }, { a: null })).toBe(true);
        expect(blueprintValuesEqual([], {})).toBe(false);
    });

    it("calls two reads of one element, colour or point the same value", () => {
        const element = () => ({ surfaceId: "s", elementId: "e1", elementType: "nl.text" });
        expect(blueprintValuesEqual(element(), element())).toBe(true);
        expect(blueprintValuesEqual(element(), { ...element(), elementId: "e2" })).toBe(false);
        expect(blueprintValuesEqual({ r: 1, g: 2, b: 3, a: 1 }, { a: 1, b: 3, g: 2, r: 1 })).toBe(true);
        expect(blueprintValuesEqual({ x: 0, y: 1 }, { x: 0, y: 2 })).toBe(false);
    });

    it("does not recurse forever into a value that contains itself", () => {
        const a: Record<string, unknown> = {};
        a.self = a;
        const b: Record<string, unknown> = {};
        b.self = b;
        expect(blueprintValuesEqual(a, a)).toBe(true);
        expect(() => blueprintValuesEqual(a, b)).not.toThrow();
    });
});
