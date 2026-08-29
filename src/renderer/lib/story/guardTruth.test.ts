import { describe, expect, it } from "vitest";
import type { StoryExpr } from "@shared/types/story";
import type { SceneFlowRange } from "@/apps/workspace/modules/story-flow/sceneFlowVariables";
import { compareRange, guardTruth } from "./guardTruth";

/**
 * The three-valued guard evaluator.
 *
 * Two things are worth pinning here and nothing else really is: that `unknown` is returned wherever
 * the answer is not certain, and that `==` on a wide interval is `unknown` rather than `true`. Both
 * are the difference between a check that finds dead endings and one that calls working ones dead.
 */

const known = (min: number, max: number): SceneFlowRange => ({ kind: "known", min, max });
const KEY = "saved:affection";
const read: StoryExpr = { kind: "var", target: { scope: "saved", variableId: "affection" }, name: "affection" };
const literal = (value: number): StoryExpr => ({ kind: "literal", value });
const binary = (op: string, left: StoryExpr, right: StoryExpr): StoryExpr =>
    ({ kind: "binary", op, left, right } as StoryExpr);

const over = (range: SceneFlowRange) => (key: string) => (key === KEY ? range : null);

describe("compareRange", () => {
    it("settles a comparison only when the whole interval agrees", () => {
        expect(compareRange({ min: 0, max: 30 }, ">=", 50)).toBe("false");
        expect(compareRange({ min: 60, max: 70 }, ">=", 50)).toBe("true");
        expect(compareRange({ min: 0, max: 70 }, ">=", 50)).toBe("unknown");
    });

    it("treats equality inside a wide interval as undecided", () => {
        // An interval is a bound, not the set of values actually reachable inside it: 0..30 does not
        // promise that 7 happens. Outside it, though, is a certain no.
        expect(compareRange({ min: 0, max: 30 }, "==", 7)).toBe("unknown");
        expect(compareRange({ min: 0, max: 30 }, "==", 31)).toBe("false");
        expect(compareRange({ min: 7, max: 7 }, "==", 7)).toBe("true");
        expect(compareRange({ min: 0, max: 30 }, "!=", 31)).toBe("true");
        expect(compareRange({ min: 7, max: 7 }, "!=", 7)).toBe("false");
    });
});

describe("guardTruth", () => {
    it("reads a comparison from either side", () => {
        expect(guardTruth(binary(">=", read, literal(50)), over(known(0, 30)))).toBe("false");
        // `50 <= affection` is the same claim written the other way round, and `<` and `>` are not
        // each other's negation - mirroring the operator rather than swapping the operands is what
        // keeps the two readings identical.
        expect(guardTruth(binary("<=", literal(50), read), over(known(0, 30)))).toBe("false");
    });

    it("settles a conjunction on one certain half", () => {
        const impossible = binary(">=", read, literal(50));
        const unreadable: StoryExpr = { kind: "call", fn: "max", args: [literal(1), literal(2)] };
        expect(guardTruth(binary("&&", impossible, unreadable), over(known(0, 30)))).toBe("false");
        // A disjunction needs both halves to fail, so the same unreadable operand leaves it open.
        expect(guardTruth(binary("||", impossible, unreadable), over(known(0, 30)))).toBe("unknown");
    });

    it("answers unknown for everything it cannot derive", () => {
        const guard = binary(">=", read, literal(50));
        expect(guardTruth(guard, () => null)).toBe("unknown");
        expect(guardTruth(guard, () => ({ kind: "unknown" }))).toBe("unknown");
        // Not a comparison at all.
        expect(guardTruth(binary("+", read, literal(1)), over(known(0, 30)))).toBe("unknown");
        // A variable on both sides: correlation is not modelled, so neither side settles it.
        expect(guardTruth(binary(">=", read, read), over(known(0, 30)))).toBe("unknown");
    });

    it("negates through `!`", () => {
        expect(guardTruth({ kind: "unary", op: "!", operand: binary(">=", read, literal(50)) }, over(known(0, 30))))
            .toBe("true");
    });
});
