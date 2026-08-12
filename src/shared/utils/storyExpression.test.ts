import type { StoryLiteralValue, StoryVariableRef } from "@shared/types/story";
import { collectStoryExpressionInvocations, collectStoryExpressionVariables, isStoryExpressionEvaluable } from "@shared/types/story/expression";
import { describe, expect, it } from "vitest";
import { evaluateStoryExpression, inferStoryExpressionType, storyExprTypeFits } from "./storyExpressionEval";
import { createStoryExpressionScope, formatStoryExpr, formatStoryExpressionName, parseStoryExpression } from "./storyExpressionParser";

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
    { name: "chapter", ref: { scope: "persistent", variableId: "chapter_global" } as StoryVariableRef },
    { name: "endings", ref: { scope: "persistent", variableId: "endings_seen" } as StoryVariableRef },
    // The `json` shapes the collection half of the language exists for: a list, a flag bag, and a
    // number to subscript with.
    { name: "inv", ref: { scope: "saved", variableId: "v_inv" } as StoryVariableRef },
    { name: "flags", ref: { scope: "saved", variableId: "v_flags" } as StoryVariableRef },
    { name: "slot", ref: { scope: "scene", variableId: "v_slot" } as StoryVariableRef },
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
    v_inv: ["sword", "potion"],
    v_flags: { ch1: true, ch2: false },
    v_slot: 1,
};

const TYPES: Record<string, "boolean" | "number" | "string" | "json"> = {
    v_gold: "number",
    v_met: "boolean",
    v_name: "string",
    v_chapter_scene: "number",
    v_chapter_saved: "number",
    chapter_global: "number",
    endings_seen: "json",
    v_inv: "json",
    v_flags: "json",
    v_slot: "number",
};

function keyOf(ref: StoryVariableRef): string {
    return ref.variableId;
}

function evaluate(source: string): StoryLiteralValue {
    const { expression, issues } = parseStoryExpression(source, SCOPE);
    expect(issues, `unexpected issues parsing \`${source}\`: ${JSON.stringify(issues)}`).toEqual([]);
    return evaluateStoryExpression(expression.ast, { read: ref => VALUES[keyOf(ref)] });
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
        // Double quotes only: single quotes are entity references now, not strings.
        expect(evaluate("\"hello\"")).toBe("hello");
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
        expect(evaluateStoryExpression(expression.ast, { read: ref => VALUES[keyOf(ref)] })).toBe(101);
    });
});

describe("quoted identifiers", () => {
    it("reads a single-quoted name as one variable reference, same node a bare name makes", () => {
        expect(evaluate("'gold' + 1")).toBe(101);
        expect(evaluate("'playerName'")).toBe("Zoe");
        // Same scope chain as a bare name: the narrowest declaration wins.
        expect(evaluate("'chapter'")).toBe(1);
    });

    it("resolves a name with spaces - the whole reason quoting exists", () => {
        const scope = createStoryExpressionScope([
            { name: "Complex Var Name", ref: { scope: "persistent", variableId: "complex" } },
        ]);
        const { expression, issues } = parseStoryExpression("'Complex Var Name' + 1", scope);
        expect(issues).toEqual([]);
        expect(evaluateStoryExpression(expression.ast, { read: () => 41 })).toBe(42);
    });

    it("takes the quoted name verbatim: no keyword reading, no scope-prefix split", () => {
        // `'saved.chapter'` looks up a variable literally named "saved.chapter" - nothing declares
        // one, so it faults as an unknown NAME, not as a qualified reference.
        expect(issueCodes("'saved.chapter'")).toEqual(["unknownVariable"]);
        expect(issueCodes("'true'")).toEqual(["unknownVariable"]);
    });

    it("faults an unknown quoted name with the same issue a bare name gets", () => {
        expect(issueCodes("'mystery'")).toEqual(["unknownVariable"]);
    });

    it("faults an unterminated quote and keeps the tree non-evaluable", () => {
        expect(issueCodes("'gold")).toEqual(["unterminatedString"]);
        const { expression } = parseStoryExpression("'gold", SCOPE);
        expect(isStoryExpressionEvaluable(expression.ast)).toBe(false);
    });

    it("keeps double quotes as strings: '\"gold\"' is text, not a read of gold", () => {
        expect(evaluate("\"gold\"")).toBe("gold");
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
        evaluateStoryExpression(expression.ast, {
            read: ref => {
                reads += 1;
                return VALUES[keyOf(ref)];
            },
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
        evaluateStoryExpression(expression.ast, {
            read: ref => {
                seen.push(keyOf(ref));
                return VALUES[keyOf(ref)];
            },
        });
        expect(seen).toEqual([]);
    });

    it("returns 0 rather than Infinity or NaN on division by zero", () => {
        expect(evaluate("1 / 0")).toBe(0);
        expect(evaluate("1 % 0")).toBe(0);
    });

    it("treats a missing variable as null", () => {
        const { expression } = parseStoryExpression("gold + 1", SCOPE);
        expect(evaluateStoryExpression(expression.ast, { read: () => undefined })).toBe(1);
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

/**
 * The collection half of the language, tested at the level that made it necessary: a `json` variable
 * could always be *stored* and, before the `array` and `index` nodes, never read back.
 */
describe("list literals and subscripts", () => {
    it("builds a list, including nested and from variables", () => {
        expect(evaluate("[1, 2, 3]")).toEqual([1, 2, 3]);
        expect(evaluate("[]")).toEqual([]);
        expect(evaluate("[[1, 2], [3]]")).toEqual([[1, 2], [3]]);
        expect(evaluate("[gold, chapter]")).toEqual([100, 1]);
    });

    it("subscripts a list, a dictionary and a string", () => {
        expect(evaluate("inv[0]")).toBe("sword");
        expect(evaluate("flags[\"ch1\"]")).toBe(true);
        // Strings index by code point, the same unit `len` and `slice` count in.
        expect(evaluate("playerName[0]")).toBe("Z");
    });

    it("chains subscripts and accepts a computed index", () => {
        expect(evaluate("[[1, 2], [3]][0][1]")).toBe(2);
        expect(evaluate("inv[slot]")).toBe("potion");
        expect(evaluate("inv[slot - 1]")).toBe("sword");
        // A call is a primary too, so a subscript follows one without parentheses.
        expect(evaluate("keys(flags)[1]")).toBe("ch2");
    });

    it("binds tighter than a unary operator", () => {
        // `-[3, 5][1]` negates the element, not the list.
        expect(evaluate("-[3, 5][1]")).toBe(-5);
    });

    it("answers null for every miss instead of throwing", () => {
        expect(evaluate("inv[9]")).toBe(null);
        // No negative indexing on a subscript: an arithmetic slip must not hand back the last item.
        expect(evaluate("inv[-1]")).toBe(null);
        expect(evaluate("flags[\"nope\"]")).toBe(null);
        expect(evaluate("gold[0]")).toBe(null);
        expect(evaluate("playerName[9]")).toBe(null);
    });

    it("faults an unclosed bracket", () => {
        expect(issueCodes("[1, 2")).toEqual(["unbalancedParen"]);
        expect(issueCodes("inv[0")).toEqual(["unbalancedParen"]);
    });
});

describe("collection functions", () => {
    it("constructs", () => {
        expect(evaluate("list(1, \"a\", true)")).toEqual([1, "a", true]);
        expect(evaluate("list()")).toEqual([]);
        expect(evaluate("dict()")).toEqual({});
    });

    it("gets, with an explicit miss value", () => {
        expect(evaluate("get(inv, 1)")).toBe("potion");
        expect(evaluate("get(flags, \"ch1\")")).toBe(true);
        expect(evaluate("get(inv, 9)")).toBe(null);
        expect(evaluate("get(inv, 9, \"none\")")).toBe("none");
        expect(evaluate("get(flags, \"nope\", false)")).toBe(false);
        // Not a collection at all: still the default, not an error.
        expect(evaluate("get(gold, 0, \"none\")")).toBe("none");
    });

    it("lists a dictionary's keys, and nothing else's", () => {
        expect(evaluate("keys(flags)")).toEqual(["ch1", "ch2"]);
        expect(evaluate("keys(inv)")).toEqual([]);
        expect(evaluate("keys(gold)")).toEqual([]);
    });

    it("rebuilds a list with push and removeAt", () => {
        expect(evaluate("push(inv, \"shield\")")).toEqual(["sword", "potion", "shield"]);
        expect(evaluate("push(gold, 1)")).toEqual([1]);
        expect(evaluate("removeAt(inv, 0)")).toEqual(["potion"]);
        // Out of range removes nothing rather than the last item.
        expect(evaluate("removeAt(inv, 9)")).toEqual(["sword", "potion"]);
        expect(evaluate("removeAt(gold, 0)")).toEqual([]);
    });

    it("rebuilds a dictionary with setKey, removeKey and hasKey", () => {
        expect(evaluate("setKey(flags, \"ch3\", true)")).toEqual({ ch1: true, ch2: false, ch3: true });
        expect(evaluate("setKey(gold, \"a\", 1)")).toEqual({ a: 1 });
        expect(evaluate("removeKey(flags, \"ch2\")")).toEqual({ ch1: true });
        expect(evaluate("removeKey(flags, \"nope\")")).toEqual({ ch1: true, ch2: false });
        expect(evaluate("hasKey(flags, \"ch2\")")).toBe(true);
        expect(evaluate("hasKey(flags, \"nope\")")).toBe(false);
        // Keys are a dictionary concept; a list is asked with indexOf/contains.
        expect(evaluate("hasKey(inv, 0)")).toBe(false);
    });

    it("searches with indexOf and contains", () => {
        expect(evaluate("indexOf(inv, \"potion\")")).toBe(1);
        expect(evaluate("indexOf(inv, \"nope\")")).toBe(-1);
        expect(evaluate("indexOf(playerName, \"oe\")")).toBe(1);
        expect(evaluate("indexOf(gold, 1)")).toBe(-1);
        expect(evaluate("contains(inv, \"sword\")")).toBe(true);
        expect(evaluate("contains(playerName, \"Zo\")")).toBe(true);
        // A dictionary's contents are its values; `hasKey` is the question about its keys.
        expect(evaluate("contains(flags, false)")).toBe(true);
        expect(evaluate("contains(gold, 1)")).toBe(false);
    });

    it("joins, slices and concatenates", () => {
        expect(evaluate("join(inv, \", \")")).toBe("sword, potion");
        expect(evaluate("join(gold, \",\")")).toBe("");
        expect(evaluate("slice(inv, 1)")).toEqual(["potion"]);
        expect(evaluate("slice(inv, 0, 1)")).toEqual(["sword"]);
        expect(evaluate("slice(playerName, 0, 2)")).toBe("Zo");
        // Unlike a subscript, slice counts a negative offset from the end - "the last one".
        expect(evaluate("slice(inv, -1)")).toEqual(["potion"]);
        expect(evaluate("slice(inv, 9)")).toEqual([]);
        expect(evaluate("slice(gold, 0)")).toEqual([]);
        expect(evaluate("concat(inv, list(\"shield\"))")).toEqual(["sword", "potion", "shield"]);
        expect(evaluate("concat(flags, dict())")).toEqual({ ch1: true, ch2: false });
        expect(evaluate("concat(inv, \"shield\")")).toEqual(["sword", "potion", "shield"]);
        // Neither side a collection: this is the string case.
        expect(evaluate("concat(\"a\", 1)")).toBe("a1");
    });

    it("measures every shape with len", () => {
        expect(evaluate("len(inv)")).toBe(2);
        expect(evaluate("len(flags)")).toBe(2);
        expect(evaluate("len(playerName)")).toBe(3);
        expect(evaluate("len(gold)")).toBe(0);
    });

    it("rewrites without touching the value it was given", () => {
        // The purity rule: an expression is a value, not a statement. The originals below are the
        // live storable's objects - mutating them would write a change nobody asked for, and would
        // also reach the snapshot copies the scene preview holds, which share structure with them.
        const inv: StoryLiteralValue = ["sword", "potion"];
        const flags: StoryLiteralValue = { ch1: true, ch2: false };
        const values: Record<string, StoryLiteralValue> = { ...VALUES, v_inv: inv, v_flags: flags };
        const run = (source: string): StoryLiteralValue => {
            const { expression, issues } = parseStoryExpression(source, SCOPE);
            expect(issues, source).toEqual([]);
            return evaluateStoryExpression(expression.ast, { read: ref => values[keyOf(ref)] });
        };

        for (const source of ["push(inv, \"shield\")", "removeAt(inv, 0)", "removeAt(inv, 9)"]) {
            expect(run(source), source).not.toBe(inv);
        }
        for (const source of ["setKey(flags, \"ch3\", true)", "removeKey(flags, \"ch1\")", "removeKey(flags, \"nope\")"]) {
            expect(run(source), source).not.toBe(flags);
        }
        expect(inv).toEqual(["sword", "potion"]);
        expect(flags).toEqual({ ch1: true, ch2: false });
    });
});

describe("string functions", () => {
    it("cases and trims, coercing a non-string the way the operators do", () => {
        expect(evaluate("upper(playerName)")).toBe("ZOE");
        expect(evaluate("lower(playerName)")).toBe("zoe");
        expect(evaluate("trim(\"  x  \")")).toBe("x");
        expect(evaluate("upper(gold)")).toBe("100");
        expect(evaluate("trim(null)")).toBe("");
    });

    it("replaces every occurrence, and leaves an empty needle alone", () => {
        expect(evaluate("replace(\"a-b-c\", \"-\", \"+\")")).toBe("a+b+c");
        expect(evaluate("replace(\"abc\", \"z\", \"x\")")).toBe("abc");
        // JS would splice the replacement between every character; that is a `split("")` artifact,
        // not anything an author half-way through typing the needle asked for.
        expect(evaluate("replace(\"abc\", \"\", \"x\")")).toBe("abc");
    });

    it("splits, including into code points", () => {
        expect(evaluate("split(\"a,b\", \",\")")).toEqual(["a", "b"]);
        expect(evaluate("split(\"ab\", \"\")")).toEqual(["a", "b"]);
        expect(evaluate("split(gold, \",\")")).toEqual(["100"]);
    });

    it("pads on the left, and cannot be made to build an unbounded string", () => {
        expect(evaluate("pad(7, 3)")).toBe("007");
        expect(evaluate("pad(\"12\", 5, \" \")")).toBe("   12");
        expect(evaluate("pad(12345, 3)")).toBe("12345");
        expect(evaluate("pad(1, 0)")).toBe("1");
        expect(evaluate("pad(7, 5, \"ab\")")).toBe("abab7");
        // No fill character means nothing to pad with - not an infinite loop.
        expect(evaluate("pad(1, 5, \"\")")).toBe("1");
        // Totality is not only "does not throw": an absurd width must not hang the scene either.
        expect((evaluate("pad(1, 999999999)") as string).length).toBe(4096);
    });

    it("converts explicitly", () => {
        expect(evaluate("str(gold)")).toBe("100");
        expect(evaluate("str(null)")).toBe("");
        expect(evaluate("num(\"12\")")).toBe(12);
        expect(evaluate("num(\"nope\")")).toBe(0);
        expect(evaluate("num(inv)")).toBe(0);
    });
});

describe("failure handling", () => {
    it("never throws, and marks an unparseable tree as non-evaluable", () => {
        for (const source of ["", "+", "1 +", "(1", "1)", "\"unterminated", "gold gold", "?:", "[1, 2", "inv[0", "inv[]", "[", "]"]) {
            const { expression, issues } = parseStoryExpression(source, SCOPE);
            expect(issues.length, `expected an issue for \`${source}\``).toBeGreaterThan(0);
            expect(isStoryExpressionEvaluable(expression.ast)).toBe(false);
            expect(() => evaluateStoryExpression(expression.ast, { read: () => undefined })).not.toThrow();
        }
    });

    it("holds the invariant the compiler relies on: any issue means a non-evaluable tree", () => {
        // The compiler's only gate is `isStoryExpressionEvaluable` - it does not re-run the parser and
        // has no access to issues. So an issue that left behind a usable tree would compile as though
        // the author had written something they did not.
        const sources = [
            "", "+", "1 +", "(1", "1)", "\"unterminated", "gold gold", "?:", "met ? 1",
            "mystery", "saved.mystery", "nope.chapter", "eval(\"1\")", "abs(1, 2)", "gold + 1 oops", "gold @ 1",
            "'mystery'", "'gold", "''",
            "[1, 2", "inv[0", "inv[]", "[", "]", "[mystery]", "inv[mystery]", "list(1,",
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

describe("formatStoryExpressionName", () => {
    it("prints a name the lexer reads back as one reference", () => {
        expect(formatStoryExpressionName("gold")).toBe("gold");
        expect(formatStoryExpressionName("金币")).toBe("金币");
        expect(formatStoryExpressionName("Complex Var Name")).toBe("'Complex Var Name'");
        // A dot would re-parse as a scope prefix, and a keyword's spelling as a literal.
        expect(formatStoryExpressionName("saved.gold")).toBe("'saved.gold'");
        expect(formatStoryExpressionName("true")).toBe("'true'");
    });

    it("round-trips through the parser", () => {
        const scope = createStoryExpressionScope([
            { name: "Complex Var Name", ref: { scope: "saved", variableId: "v_c" } },
        ]);
        const source = `${formatStoryExpressionName("Complex Var Name")} + 1`;
        const { expression, issues } = parseStoryExpression(source, scope);
        expect(issues).toEqual([]);
        expect(evaluateStoryExpression(expression.ast, { read: () => 1 })).toBe(2);
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

    it("descends into a list literal and into both halves of a subscript", () => {
        // Missing either half is silent: the compiler builds its reader from exactly this list, so a
        // ref it never saw evaluates as `undefined` at runtime rather than failing the build.
        const list = parseStoryExpression("[gold, saved.chapter]", SCOPE);
        expect(collectStoryExpressionVariables(list.expression.ast)).toEqual([
            { scope: "scene", variableId: "v_gold" },
            { scope: "saved", variableId: "v_chapter_saved" },
        ]);
        const subscript = parseStoryExpression("inv[slot]", SCOPE);
        expect(collectStoryExpressionVariables(subscript.expression.ast)).toEqual([
            { scope: "saved", variableId: "v_inv" },
            { scope: "scene", variableId: "v_slot" },
        ]);
    });
});

/**
 * The two reference nodes and the blueprint call (schema v15).
 *
 * Their own scope, because they are the only part of the language that resolves against something
 * other than variables - and the point of every test here is that what the tree stores is an ID: a
 * scene rename, an option reword or a blueprint rename must not be able to break a committed line.
 */
describe("visited / picked / invoke", () => {
    const ENTITIES = {
        scenes: [{ id: "sc_prologue", name: "序章" }, { id: "sc_two", name: "第 二 章" }],
        options: [
            { id: "opt_refuse", name: "那句拒绝" },
            // Two options reading "Yes", which is what any real project looks like - the case the
            // ambiguity answer exists for.
            { id: "opt_yes_a", name: "Yes" },
            { id: "opt_yes_b", name: "Yes" },
        ],
        blueprints: [{ id: "bp_bonus", name: "bonus" }, { id: "bp_default", name: "Story Value" }, { id: "bp_min", name: "min" }],
    };
    const WORLD = createStoryExpressionScope(VARIABLES, ENTITIES);

    const parse = (source: string) => parseStoryExpression(source, WORLD);
    const codes = (source: string) => parse(source).issues.map(issue => issue.code);

    it("stores the id, never the name", () => {
        const { expression, issues } = parse("visited(序章)");
        expect(issues).toEqual([]);
        expect(expression.ast).toEqual({ kind: "visited", target: { kind: "scene", sceneId: "sc_prologue" }, name: "序章" });

        const picked = parse("picked(那句拒绝)");
        expect(picked.issues).toEqual([]);
        expect(picked.expression.ast).toEqual({ kind: "visited", target: { kind: "option", blockId: "opt_refuse" }, name: "那句拒绝" });
    });

    it("keeps hitting the same id after the scene is renamed and the option reworded", () => {
        // The whole reason this is a node and not `visited("序章")`. Parse against today's names,
        // then evaluate the STORED tree against a record that only knows ids - which is what the
        // compiler does at runtime - with the name tables since rewritten out from under it.
        const { expression } = parse("visited(序章) && picked(那句拒绝)");
        const renamed = createStoryExpressionScope(VARIABLES, {
            scenes: [{ id: "sc_prologue", name: "Prologue (rewritten)" }],
            options: [{ id: "opt_refuse", name: "I would rather not." }],
        });
        // The old spelling no longer resolves - as it should not, for a NEW line...
        expect(parseStoryExpression("visited(序章)", renamed).issues.map(i => i.code)).toEqual(["unknownVisitedTarget"]);
        // ...while the committed tree is untouched and still answers about the same two ids.
        const seen = new Set(["sc_prologue", "opt_refuse"]);
        expect(evaluateStoryExpression(expression.ast, {
            read: () => undefined,
            visited: ref => seen.has(ref.kind === "scene" ? ref.sceneId : ref.blockId),
        })).toBe(true);
    });

    it("reports an unknown name and leaves an invalid tree", () => {
        expect(codes("visited(没有这个场景)")).toEqual(["unknownVisitedTarget"]);
        expect(isStoryExpressionEvaluable(parse("visited(没有这个场景)").expression.ast)).toBe(false);
        // The name is looked up in the table the CALL names: a scene is not an option.
        expect(codes("picked(序章)")).toEqual(["unknownVisitedTarget"]);
    });

    it("refuses to guess between two things with the same name", () => {
        expect(codes("picked(Yes)")).toEqual(["ambiguousReference"]);
        expect(isStoryExpressionEvaluable(parse("picked(Yes)").expression.ast)).toBe(false);
    });

    it("takes a quoted entity name, so a name with spaces is addressable", () => {
        const { expression, issues } = parse("visited('第 二 章')");
        expect(issues).toEqual([]);
        expect(expression.ast).toEqual({ kind: "visited", target: { kind: "scene", sceneId: "sc_two" }, name: "第 二 章" });
    });

    it("reads as false where the host cannot answer", () => {
        // An env with no `visited` capability is a host that does not track the record (the document
        // migration, a test), and "not visited" is the same answer an empty record gives.
        const { expression } = parse("visited(序章)");
        expect(evaluateStoryExpression(expression.ast, { read: () => undefined })).toBe(false);
    });

    it("lets the built-in win its name, and says so", () => {
        // `min` names both a whitelisted function and a blueprint here. The tree is the BUILT-IN, so
        // an already-committed `min(1, 2)` keeps meaning what it meant...
        const { expression, issues } = parse("min(1, 2)");
        expect(expression.ast).toEqual({
            kind: "call",
            fn: "min",
            args: [{ kind: "literal", value: 1 }, { kind: "literal", value: 2 }],
        });
        // ...but the collision is reported rather than resolved in silence.
        expect(issues.map(issue => issue.code)).toEqual(["blueprintShadowsFunction"]);
        // A function with no blueprint behind it is untouched.
        expect(codes("max(1, 2)")).toEqual([]);
    });

    it("calls a blueprint whose name is quoted, including one shadowing a built-in", () => {
        expect(parse("'Story Value'()").expression.ast).toEqual({ kind: "invoke", blueprintId: "bp_default", name: "Story Value" });
        // The escape from the collision above, without renaming anything.
        expect(parse("'min'()").expression.ast).toEqual({ kind: "invoke", blueprintId: "bp_min", name: "min" });
        expect(parse("'min'()").issues).toEqual([]);
    });

    it("composes into a larger expression", () => {
        // `/set x bonus() * 2` - the slot that could not name a blueprint at all before v15.
        const { expression, issues } = parse("bonus() * 2");
        expect(issues).toEqual([]);
        expect(expression.ast).toEqual({
            kind: "binary",
            op: "*",
            left: { kind: "invoke", blueprintId: "bp_bonus", name: "bonus" },
            right: { kind: "literal", value: 2 },
        });
        expect(evaluateStoryExpression(expression.ast, { read: () => undefined, invoke: () => 21 })).toBe(42);
    });

    it("reports a call that names nothing, and a call given arguments", () => {
        expect(codes("nope()")).toEqual(["unknownFunction"]);
        expect(codes("'nope'()")).toEqual(["unknownBlueprint"]);
        expect(codes("bonus(1)")).toEqual(["blueprintTakesNoArguments"]);
    });

    it("stays total when the blueprint throws", () => {
        // Graph execution throws freely (`BlueprintGraphExecutionError`, `executeGraphSync`), and the
        // catch lives inside the node precisely so this invariant survives it. A throw escaping here
        // would take down a compiled Script mid-scene.
        const { expression } = parse("bonus() + 1");
        const explode = (): never => { throw new Error("graph blew up"); };
        expect(() => evaluateStoryExpression(expression.ast, { read: () => undefined, invoke: explode })).not.toThrow();
        expect(evaluateStoryExpression(expression.ast, { read: () => undefined, invoke: explode })).toBe(1);
        // And with no invoker at all, the same zero.
        expect(evaluateStoryExpression(parse("bonus()").expression.ast, { read: () => undefined })).toBe(null);
    });

    it("infers boolean for a record read and unknown for a call", () => {
        const infer = (source: string) => inferStoryExpressionType(parse(source).expression.ast, ref => TYPES[keyOf(ref)]);
        expect(infer("visited(序章)")).toBe("boolean");
        expect(infer("picked(那句拒绝)")).toBe("boolean");
        // NOT the graph's declared return type: the author may change it with nothing rechecking
        // the expressions that call it, so claiming a type here would be a check that lies.
        expect(infer("bonus()")).toBe("unknown");
    });

    it("collects the blueprints a tree calls, and no variables", () => {
        const { expression } = parse("visited(序章) ? bonus() : gold");
        expect(collectStoryExpressionInvocations(expression.ast)).toEqual([{ blueprintId: "bp_bonus", name: "bonus" }]);
        // The reference nodes contribute no variable reads - `gold` is the only one here.
        expect(collectStoryExpressionVariables(expression.ast)).toEqual([{ scope: "scene", variableId: "v_gold" }]);
    });

    it("prints back to source that re-parses to the same tree", () => {
        const sources = [
            "visited(序章)", "visited('第 二 章')", "picked(那句拒绝)",
            "'Story Value'()", "bonus()",
            "(visited(序章) && picked(那句拒绝))", "(bonus() * 2)",
        ];
        for (const source of sources) {
            const first = parseStoryExpression(source, WORLD);
            expect(first.issues, source).toEqual([]);
            // Through the printer, not through the stored source - this is the path a desugared
            // `/inc` takes, and the only one where a mis-quoted name would silently change meaning.
            const printed = formatStoryExpr(first.expression.ast);
            expect(printed, source).toBe(source);
            expect(parseStoryExpression(printed, WORLD).expression.ast, source).toEqual(first.expression.ast);
        }
    });
});

describe("source round trip", () => {
    it("re-parses a stored source to the identical tree", () => {
        // The document stores the tree AND the author's source; re-opening a row re-parses the
        // source, so the two must agree or an untouched row would commit a different expression.
        // The spellings below include the exact shapes `formatExpr` (storySceneProjection) emits for
        // the new nodes - `[a, b]`, `t[i]`, parenthesized binaries - so printing stays inside the
        // grammar that parses.
        const sources = [
            "[1, 2, 3]", "[]", "[[1, 2], [3]]", "inv[0]", "flags[\"ch1\"]",
            "[[1, 2], [3]][0][1]", "inv[slot]", "inv[(slot - 1)]", "-inv[0]",
            "push(inv, \"shield\")", "get(flags, \"ch1\", false)",
            "join(slice(inv, 0, 1), \", \")", "(len(keys(flags)) > 1)",
        ];
        for (const source of sources) {
            const first = parseStoryExpression(source, SCOPE);
            expect(first.issues, source).toEqual([]);
            const second = parseStoryExpression(first.expression.source, SCOPE);
            expect(second.expression.ast, source).toEqual(first.expression.ast);
        }
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

    it("types a function by what it returns", () => {
        // A blanket `number` was true while every function was arithmetic; `/set gold upper(name)`
        // is the case that made it a lie.
        expect(infer("upper(playerName)")).toBe("string");
        expect(infer("join(inv, \",\")")).toBe("string");
        expect(infer("hasKey(flags, \"ch1\")")).toBe("boolean");
        expect(infer("contains(inv, \"sword\")")).toBe("boolean");
        expect(infer("indexOf(inv, \"sword\")")).toBe("number");
        expect(infer("num(playerName)")).toBe("number");
        expect(storyExprTypeFits(infer("upper(playerName)"), "number")).toBe(false);
    });

    it("declines to type a collection, which is what lets one into a json variable", () => {
        // `StoryExprType` has no list arm, and `unknown` is read as "allow" - so a rewrite commits
        // to a `json` variable without the lattice needing to grow.
        expect(infer("[1, 2]")).toBe("unknown");
        expect(infer("inv[0]")).toBe("unknown");
        expect(infer("list(1, 2)")).toBe("unknown");
        expect(infer("push(inv, \"x\")")).toBe("unknown");
        expect(storyExprTypeFits(infer("push(inv, \"x\")"), "json")).toBe(true);
        expect(storyExprTypeFits(infer("[1, 2]"), "json")).toBe(true);
    });
});

describe("AppTag", () => {
    const parseWith = (source: string, appTags?: { id: string; name: string }[]) =>
        parseStoryExpression(source, createStoryExpressionScope(VARIABLES, appTags ? { appTags } : {}));

    it("reads as the build-variant constant, whatever its case", () => {
        for (const source of ["AppTag", "apptag", "APPTAG"]) {
            expect(parseWith(source).expression.ast, source).toEqual({ kind: "call", fn: "appTag", args: [] });
        }
    });

    it("wins the bare name from a variable that shares it", () => {
        const scope = createStoryExpressionScope([
            ...VARIABLES,
            { name: "AppTag", ref: { scope: "saved", variableId: "v_apptag" } as StoryVariableRef },
        ]);
        expect(parseStoryExpression("AppTag", scope).expression.ast).toEqual({ kind: "call", fn: "appTag", args: [] });
        // Quoting is how that variable is still reachable - and how the printer spells it back.
        expect(parseStoryExpression("'AppTag'", scope).expression.ast).toMatchObject({ kind: "var", name: "AppTag" });
        expect(formatStoryExpressionName("AppTag")).toBe("'AppTag'");
    });

    it("prints back as the bare word, so a folded document round-trips", () => {
        const ast = parseWith("AppTag == \"Demo\"").expression.ast;
        expect(formatStoryExpr(ast)).toBe("(AppTag == \"Demo\")");
        expect(parseWith(formatStoryExpr(ast)).expression.ast).toEqual(ast);
    });

    it("is a string, so a comparison is a condition and an assignment fits a string", () => {
        const infer = (source: string) => inferStoryExpressionType(parseWith(source).expression.ast, () => undefined);
        expect(infer("AppTag")).toBe("string");
        expect(infer("AppTag == \"Demo\"")).toBe("boolean");
    });

    it("reports a name no variant has, and only where the caller can enumerate them", () => {
        const tags = [{ id: "release", name: "Release" }, { id: "t1", name: "Demo" }];
        expect(parseWith("AppTag == \"Demo\"", tags).issues).toEqual([]);
        expect(parseWith("AppTag == \"demo\"", tags).issues)
            .toEqual([{ code: "unknownAppTagName", span: { start: 0, end: 16 }, name: "demo" }]);
        // No list, no opinion: the fold, the migration and the tests all parse without one.
        expect(parseWith("AppTag == \"Nothing\"").issues).toEqual([]);
    });

    it("says nothing about a comparison with no fixed name to check", () => {
        const tags = [{ id: "release", name: "Release" }];
        expect(parseWith("AppTag == playerName", tags).issues).toEqual([]);
    });
});
