import type { StoryLiteralValue } from "@shared/types/story";
import type { StoryExpr } from "@shared/types/story/expression";
import { describe, expect, it } from "vitest";
import { evaluateStoryExpression, strictEquals } from "./storyExpressionEval";

/**
 * `strictEquals` is the one equality rule shared by `/if` expressions and the compiler's persistent
 * conditions. It is strict (no coercion) and structural (json/arrays by shape). These
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

/**
 * The `array` and `index` nodes exercised as TREES rather than through the parser, because that is
 * how the compiler meets them: it reads `expression.ast` out of the document and never re-parses.
 * A tree the parser cannot currently produce (hand-written, migrated, or written by a future
 * command sugar) must still evaluate to the same thing.
 */
describe("collection nodes", () => {
    const VAR: StoryExpr = { kind: "var", target: { scope: "saved", variableId: "v_inv" }, name: "inv" };
    const evaluate = (expr: StoryExpr, value: StoryLiteralValue): StoryLiteralValue =>
        evaluateStoryExpression(expr, { read: () => value });

    it("evaluates a list literal element by element", () => {
        const expr: StoryExpr = {
            kind: "array",
            items: [{ kind: "literal", value: 1 }, VAR, { kind: "unary", op: "-", operand: { kind: "literal", value: 2 } }],
        };
        expect(evaluate(expr, "x")).toEqual([1, "x", -2]);
    });

    it("subscripts whatever the target turns out to hold, and never throws", () => {
        const expr: StoryExpr = { kind: "index", target: VAR, index: { kind: "literal", value: 1 } };
        expect(evaluate(expr, ["a", "b"])).toBe("b");
        expect(evaluate(expr, { 1: "one" })).toBe("one");
        expect(evaluate(expr, "ab")).toBe("b");
        // Every degenerate shape answers null: too short, wrong shape, absent.
        expect(evaluate(expr, ["a"])).toBe(null);
        expect(evaluate(expr, 42)).toBe(null);
        expect(evaluate(expr, null)).toBe(null);
    });

    it("keeps a rewrite's untouched levels shared, and the original intact", () => {
        // Shallow copies are the contract (see the header): `push` rebuilds the outer list and shares
        // every element with the input. That is observationally pure because nothing in the language
        // can reach into a shared element and change it - every writer rebuilds the level it edits.
        const nested: StoryLiteralValue = [{ id: "a" }];
        const original: StoryLiteralValue = [nested];
        const pushed = evaluate(
            { kind: "call", fn: "push", args: [VAR, { kind: "literal", value: 1 }] },
            original,
        ) as StoryLiteralValue[];
        expect(pushed).not.toBe(original);
        expect(original).toEqual([nested]);
        expect(pushed[0]).toBe(nested);
    });
});
