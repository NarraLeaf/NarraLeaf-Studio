import type { StoryLiteralValue, StoryVariableRef } from "@shared/types/story";
import { collectStoryExpressionVariables, isStoryExpressionEvaluable } from "@shared/types/story/expression";
import { describe, expect, it } from "vitest";
import { evaluateStoryExpression, inferStoryExpressionType, storyExprTypeFits } from "./storyExpressionEval";
import { createStoryExpressionScope, parseStoryExpression } from "./storyExpressionParser";

/**
 * The expression language's contract, tested at the level an author experiences it: type a line, get
 * a value. Parser and evaluator are exercised together because neither is independently meaningful -
 * a precedence bug and an evaluation bug are indistinguishable from the row the author is typing in.
 */

const VARIABLES = [
    { name: "gold", ref: { scope: "scene", variableId: "v_gold" } as StoryVariableRef },
    { name: "met", ref: { scope: "scene", variableId: "v_met" } as StoryVariableRef },
    { name: "playerName", ref: { scope: "saved", variableId: "v_name" } as StoryVariableRef },
    // Deliberately shadowed: a `chapter` in every scope, to pin the scope-chain order.
    { name: "chapter", ref: { scope: "scene", variableId: "v_chapter_scene" } as StoryVariableRef },
    { name: "chapter", ref: { scope: "saved", variableId: "v_chapter_saved" } as StoryVariableRef },
    { name: "chapter", ref: { scope: "persistent", storageKey: "chapter_global" } as StoryVariableRef },
    { name: "endings", ref: { scope: "persistent", storageKey: "endings_seen" } as StoryVariableRef },
];

const SCOPE = createStoryExpressionScope(VARIABLES);

const VALUES: Record<string, StoryLiteralValue> = {
    v_gold: 100,
    v_met: true,
    v_name: "Zoe",
    v_chapter_scene: 1,
    v_chapter_saved: 2,
    chapter_global: 3,
    endings_seen: ["a", "b"],
};

const TYPES: Record<string, "boolean" | "number" | "string" | "json"> = {
    v_gold: "number",
    v_met: "boolean",
    v_name: "string",
    v_chapter_scene: "number",
    v_chapter_saved: "number",
    chapter_global: "number",
    endings_seen: "json",
};

function keyOf(ref: StoryVariableRef): string {
    return ref.scope === "persistent" ? ref.storageKey : ref.variableId;
}

function evaluate(source: string): StoryLiteralValue {
    const { expression, issues } = parseStoryExpression(source, SCOPE);
    expect(issues, `unexpected issues parsing \`${source}\`: ${JSON.stringify(issues)}`).toEqual([]);
    return evaluateStoryExpression(expression.ast, ref => VALUES[keyOf(ref)]);
}

function issueCodes(source: string): string[] {
    return parseStoryExpression(source, SCOPE).issues.map(issue => issue.code);
}

describe("parseStoryExpression", () => {
    it("parses literals of every scalar kind", () => {
        expect(evaluate("42")).toBe(42);
        expect(evaluate("1.5")).toBe(1.5);
        expect(evaluate("true")).toBe(true);
        expect(evaluate("false")).toBe(false);
        expect(evaluate("null")).toBe(null);
        expect(evaluate("\"hello\"")).toBe("hello");
        expect(evaluate("'hello'")).toBe("hello");
    });

    it("reads a variable through the scope chain", () => {
        expect(evaluate("gold")).toBe(100);
        expect(evaluate("playerName")).toBe("Zoe");
    });

    it("prefers the narrowest scope for a shadowed bare name", () => {
        expect(evaluate("chapter")).toBe(1);
    });

    it("addresses a shadowed variable by scope prefix", () => {
        expect(evaluate("scene.chapter")).toBe(1);
        expect(evaluate("saved.chapter")).toBe(2);
        expect(evaluate("persis.chapter")).toBe(3);
        // Command-name aliases resolve to the same scopes, so the prefix matches what the author declared with.
        expect(evaluate("local.chapter")).toBe(1);
        expect(evaluate("var.chapter")).toBe(2);
    });

    it("faults on an unknown scope prefix rather than treating it as a name", () => {
        expect(issueCodes("nope.chapter")).toEqual(["unknownScopePrefix"]);
    });

    it("faults on a name nothing declares", () => {
        expect(issueCodes("mystery + 1")).toEqual(["unknownVariable"]);
        expect(issueCodes("saved.mystery")).toEqual(["unknownQualifiedVariable"]);
    });

    it("accepts non-ASCII identifiers", () => {
        const scope = createStoryExpressionScope([
            { name: "金币", ref: { scope: "scene", variableId: "v_gold" } },
        ]);
        const { expression, issues } = parseStoryExpression("金币 + 1", scope);
        expect(issues).toEqual([]);
        expect(evaluateStoryExpression(expression.ast, ref => VALUES[keyOf(ref)])).toBe(101);
    });
});

describe("operator precedence", () => {
    it("multiplies before adding", () => {
        expect(evaluate("2 + 3 * 4")).toBe(14);
        expect(evaluate("(2 + 3) * 4")).toBe(20);
    });

    it("keeps subtraction left-associative", () => {
        expect(evaluate("10 - 3 - 2")).toBe(5);
    });

    it("compares before combining with && and ||", () => {
        expect(evaluate("gold > 50 && met")).toBe(true);
        expect(evaluate("gold > 500 || met")).toBe(true);
        expect(evaluate("gold > 500 && met")).toBe(false);
    });

    it("binds && tighter than ||", () => {
        // false || (true && false) === false; a wrong precedence would group as (false || true) && false.
        expect(evaluate("false || true && false")).toBe(false);
    });

    it("binds unary tighter than binary", () => {
        expect(evaluate("-2 * 3")).toBe(-6);
        expect(evaluate("!met")).toBe(false);
        expect(evaluate("!false && true")).toBe(true);
    });
});

describe("ternary", () => {
    it("selects a branch", () => {
        expect(evaluate("gold > 50 ? \"rich\" : \"poor\"")).toBe("rich");
        expect(evaluate("gold > 500 ? \"rich\" : \"poor\"")).toBe("poor");
    });

    it("chains to the right without parentheses", () => {
        const source = "gold > 500 ? \"S\" : gold > 50 ? \"A\" : \"B\"";
        expect(evaluate(source)).toBe("A");
    });

    it("binds looser than every binary operator", () => {
        // Parsed as (gold > 50) ? … : …, not gold > (50 ? … : …).
        expect(evaluate("gold > 50 ? 1 : 2")).toBe(1);
    });

    it("faults on a missing branch", () => {
        expect(issueCodes("met ? 1")).toEqual(["unexpectedEnd"]);
    });

    it("evaluates only the taken branch", () => {
        // The untaken branch divides by a variable that would be a problem if it were read eagerly;
        // this is really a statement that evaluation is lazy, which matters once reads have cost.
        let reads = 0;
        const { expression } = parseStoryExpression("met ? 1 : gold", SCOPE);
        evaluateStoryExpression(expression.ast, ref => {
            reads += 1;
            return VALUES[keyOf(ref)];
        });
        expect(reads).toBe(1);
    });
});

describe("evaluation semantics", () => {
    it("concatenates when either side is a string", () => {
        expect(evaluate("\"第 \" + chapter + \" 章\"")).toBe("第 1 章");
        expect(evaluate("1 + 2")).toBe(3);
    });

    it("uses strict equality", () => {
        expect(evaluate("\"1\" == 1")).toBe(false);
        expect(evaluate("1 == 1")).toBe(true);
        expect(evaluate("met == true")).toBe(true);
    });

    it("returns booleans from && and ||, not the surviving operand", () => {
        expect(evaluate("playerName || \"Stranger\"")).toBe(true);
        expect(evaluate("gold && playerName")).toBe(true);
    });

    it("short-circuits && and ||", () => {
        const seen: string[] = [];
        const { expression } = parseStoryExpression("false && gold", SCOPE);
        evaluateStoryExpression(expression.ast, ref => {
            seen.push(keyOf(ref));
            return VALUES[keyOf(ref)];
        });
        expect(seen).toEqual([]);
    });

    it("returns 0 rather than Infinity or NaN on division by zero", () => {
        expect(evaluate("1 / 0")).toBe(0);
        expect(evaluate("1 % 0")).toBe(0);
    });

    it("treats a missing variable as null", () => {
        const { expression } = parseStoryExpression("gold + 1", SCOPE);
        expect(evaluateStoryExpression(expression.ast, () => undefined)).toBe(1);
    });

    it("compares strings lexicographically and everything else numerically", () => {
        expect(evaluate("\"a\" < \"b\"")).toBe(true);
        expect(evaluate("gold >= 100")).toBe(true);
        expect(evaluate("true > false")).toBe(true);
    });
});

describe("functions", () => {
    it("evaluates the whitelist", () => {
        expect(evaluate("min(3, 1, 2)")).toBe(1);
        expect(evaluate("max(3, 1, 2)")).toBe(3);
        expect(evaluate("abs(-5)")).toBe(5);
        expect(evaluate("round(1.5)")).toBe(2);
        expect(evaluate("floor(1.9)")).toBe(1);
        expect(evaluate("ceil(1.1)")).toBe(2);
        expect(evaluate("len(playerName)")).toBe(3);
        expect(evaluate("len(endings)")).toBe(2);
    });

    it("clamps within a range, tolerating a reversed one", () => {
        expect(evaluate("clamp(150, 0, 100)")).toBe(100);
        expect(evaluate("clamp(-5, 0, 100)")).toBe(0);
        expect(evaluate("clamp(150, 100, 0)")).toBe(100);
    });

    it("keeps randomInt inclusive on both ends", () => {
        for (let attempt = 0; attempt < 200; attempt += 1) {
            const value = evaluate("randomInt(1, 6)") as number;
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(1);
            expect(value).toBeLessThanOrEqual(6);
        }
    });

    it("rejects a function outside the whitelist", () => {
        expect(issueCodes("eval(\"1\")")).toEqual(["unknownFunction"]);
        expect(issueCodes("fetch(\"x\")")).toEqual(["unknownFunction"]);
    });

    it("rejects the wrong number of arguments", () => {
        expect(issueCodes("abs(1, 2)")).toEqual(["badArity"]);
        expect(issueCodes("clamp(1)")).toEqual(["badArity"]);
    });
});

describe("failure handling", () => {
    it("never throws, and marks an unparseable tree as non-evaluable", () => {
        for (const source of ["", "+", "1 +", "(1", "1)", "\"unterminated", "gold gold", "?:"]) {
            const { expression, issues } = parseStoryExpression(source, SCOPE);
            expect(issues.length, `expected an issue for \`${source}\``).toBeGreaterThan(0);
            expect(isStoryExpressionEvaluable(expression.ast)).toBe(false);
            expect(() => evaluateStoryExpression(expression.ast, () => undefined)).not.toThrow();
        }
    });

    it("holds the invariant the compiler relies on: any issue means a non-evaluable tree", () => {
        // The compiler's only gate is `isStoryExpressionEvaluable` - it does not re-run the parser and
        // has no access to issues. So an issue that left behind a usable tree would compile as though
        // the author had written something they did not.
        const sources = [
            "", "+", "1 +", "(1", "1)", "\"unterminated", "gold gold", "?:", "met ? 1",
            "mystery", "saved.mystery", "nope.chapter", "eval(\"1\")", "abs(1, 2)", "gold + 1 oops", "gold @ 1",
        ];
        for (const source of sources) {
            const { expression, issues } = parseStoryExpression(source, SCOPE);
            expect(issues.length, `expected an issue for \`${source}\``).toBeGreaterThan(0);
            expect(isStoryExpressionEvaluable(expression.ast), `\`${source}\` parsed to an evaluable tree`).toBe(false);
        }
    });

    it("keeps the author's source on the expression", () => {
        const source = "gold + 1";
        expect(parseStoryExpression(source, SCOPE).expression.source).toBe(source);
    });

    it("faults rather than evaluating a prefix of a partly-valid line", () => {
        // `gold + 1 oops` must not quietly become `gold + 1`.
        const { expression } = parseStoryExpression("gold + 1 oops", SCOPE);
        expect(isStoryExpressionEvaluable(expression.ast)).toBe(false);
    });
});

describe("collectStoryExpressionVariables", () => {
    it("finds every referenced variable once, in encounter order", () => {
        const { expression } = parseStoryExpression("gold + saved.chapter + gold", SCOPE);
        expect(collectStoryExpressionVariables(expression.ast)).toEqual([
            { scope: "scene", variableId: "v_gold" },
            { scope: "saved", variableId: "v_chapter_saved" },
        ]);
    });

    it("reaches into every branch, including untaken ones", () => {
        const { expression } = parseStoryExpression("met ? gold : persis.chapter", SCOPE);
        expect(collectStoryExpressionVariables(expression.ast)).toHaveLength(3);
    });
});

describe("inferStoryExpressionType", () => {
    const infer = (source: string) => {
        const { expression } = parseStoryExpression(source, SCOPE);
        return inferStoryExpressionType(expression.ast, ref => TYPES[keyOf(ref)]);
    };

    it("infers scalar results", () => {
        expect(infer("1 + 1")).toBe("number");
        expect(infer("gold - 1")).toBe("number");
        expect(infer("gold > 1")).toBe("boolean");
        expect(infer("!met")).toBe("boolean");
        expect(infer("\"a\" + gold")).toBe("string");
        expect(infer("min(1, 2)")).toBe("number");
    });

    it("declines to guess where a branch or a json variable defeats it", () => {
        expect(infer("met ? 1 : \"one\"")).toBe("unknown");
        expect(infer("endings")).toBe("unknown");
        // An unknown operand of `+` could still be a string, so the sum is not provably numeric.
        expect(infer("endings + 1")).toBe("unknown");
    });

    it("agrees on matching branches", () => {
        expect(infer("met ? 1 : 2")).toBe("number");
    });

    it("treats unknown as assignable, so a missed inference never blocks the author", () => {
        expect(storyExprTypeFits("unknown", "number")).toBe(true);
        expect(storyExprTypeFits("string", "number")).toBe(false);
        expect(storyExprTypeFits("number", "number")).toBe(true);
        expect(storyExprTypeFits("string", "json")).toBe(true);
    });
});
