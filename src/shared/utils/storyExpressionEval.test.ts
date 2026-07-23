import { describe, expect, it } from "vitest";
import { strictEquals } from "./storyExpressionEval";

/**
 * `strictEquals` is the one equality rule shared by `/if` expressions and the compiler's persistent
 * conditions (bible §3.3). It is strict (no coercion) and structural (json/arrays by shape). These
 * lock both halves so a future change cannot quietly reintroduce reference identity or coercion.
 */
describe("strictEquals", () => {
    it("is strict — no cross-type coercion", () => {
        expect(strictEquals("1", 1)).toBe(false);
        expect(strictEquals(0, false)).toBe(false);
        expect(strictEquals(1, 1)).toBe(true);
        expect(strictEquals("a", "a")).toBe(true);
        expect(strictEquals(true, true)).toBe(true);
    });

    it("compares json / arrays structurally, not by reference", () => {
        expect(strictEquals({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] })).toBe(true);
        expect(strictEquals([1, 2, 3], [1, 2, 3])).toBe(true);
        expect(strictEquals({ a: 1 }, { a: 2 })).toBe(false);
        expect(strictEquals([1, 2], [1, 2, 3])).toBe(false);
    });

    it("handles null distinctly from other falsy values", () => {
        expect(strictEquals(null, null)).toBe(true);
        expect(strictEquals(null, 0)).toBe(false);
        expect(strictEquals(null, false)).toBe(false);
    });
});
