import type { StoryConditionRef, StoryExpr, StoryExprBinaryOp } from "@shared/types/story";
import { storyVariableRefKey } from "@shared/types/story";
import type { SceneFlowRange } from "@/apps/workspace/modules/story-flow/sceneFlowVariables";

/**
 * Whether a guard can hold at all, given what its variables can be worth where it is written.
 *
 * Three-valued on purpose, and the third value is the common one. `unknown` is what this answers for
 * every shape it does not fully understand — a string comparison, a `visited()`, a call, a variable
 * with no derivable range — and the whole usefulness of the answer rests on `false` being reserved
 * for the cases where it is certain.
 *
 * # Why an interval is enough
 *
 * The ranges this reads over-approximate: they hold every value a player can actually arrive with,
 * and usually more. That direction is what makes a negative answer sound. If the widest interval the
 * variable can hold is 0..30, then `好感 >= 50` cannot hold on any path, and no amount of extra
 * precision in the analysis could change that. The reverse is not true, which is why `true` is
 * computed but not reported by anything: an interval that happens to satisfy a comparison says only
 * that this analysis found no counter-example, not that none exists.
 *
 * # What is deliberately not modelled
 *
 * Correlation between variables. `好感 >= 50 && 信頼 <= 0` is judged one conjunct at a time, so a
 * pair that can each hold but never together reads as `unknown`. Tracking that needs a relational
 * domain, and an interval analysis that guessed at it would produce exactly the confident wrong
 * answer this file exists to avoid.
 */
export type GuardTruth = "true" | "false" | "unknown";

/** The comparisons an interval can settle. Arithmetic operators are not guards. */
type ComparisonOp = "==" | "!=" | "<" | "<=" | ">" | ">=";

const COMPARISONS: readonly ComparisonOp[] = ["==", "!=", "<", "<=", ">", ">="];

/** `a < b` read from the other side is `b > a` — how a literal-on-the-left comparison is normalised. */
const MIRRORED: Record<ComparisonOp, ComparisonOp> = {
    "==": "==",
    "!=": "!=",
    "<": ">",
    "<=": ">=",
    ">": "<",
    ">=": "<=",
};

/**
 * Whether every value in `range` satisfies `range <op> value`, none of them does, or neither.
 *
 * Read as "the variable is on the left". A caller with the literal on the left mirrors the operator
 * first rather than swapping the arguments, because `<` and `>` are not each other's negation and
 * getting that backwards turns a silent check into a wrong one.
 */
export function compareRange(range: { min: number; max: number }, op: ComparisonOp, value: number): GuardTruth {
    const { min, max } = range;
    switch (op) {
        case ">=":
            return min >= value ? "true" : max < value ? "false" : "unknown";
        case ">":
            return min > value ? "true" : max <= value ? "false" : "unknown";
        case "<=":
            return max <= value ? "true" : min > value ? "false" : "unknown";
        case "<":
            return max < value ? "true" : min >= value ? "false" : "unknown";
        case "==":
            // Outside the interval is a certain no. Inside it is only certain when the interval holds
            // one number: an interval is a bound, not the set of values actually reachable inside it.
            if (value < min || value > max) {
                return "false";
            }
            return min === max ? "true" : "unknown";
        case "!=":
            if (value < min || value > max) {
                return "true";
            }
            return min === max ? "false" : "unknown";
    }
}

function negate(truth: GuardTruth): GuardTruth {
    return truth === "true" ? "false" : truth === "false" ? "true" : "unknown";
}

function numericLiteral(expr: StoryExpr): number | null {
    if (expr.kind !== "literal" || typeof expr.value !== "number" || !Number.isFinite(expr.value)) {
        return null;
    }
    return expr.value;
}

/**
 * What a guard evaluates to over the ranges its variables can hold.
 *
 * `rangeOf` answers for one variable key and may return `null` for "no claim" — a non-numeric
 * variable, one with no declared default, one in a scene the entry cannot reach. Every `null` and
 * every `unknown` range propagates as `unknown`, which is what keeps a partially-derivable guard
 * from being judged on the half that was derivable.
 */
export function guardTruth(expr: StoryExpr, rangeOf: (variableKey: string) => SceneFlowRange | null): GuardTruth {
    if (expr.kind === "literal") {
        return typeof expr.value === "boolean" ? (expr.value ? "true" : "false") : "unknown";
    }
    if (expr.kind === "unary") {
        // Only `!` is a guard operator; unary `-` on a boolean position is not a shape to reason about.
        return expr.op === "!" ? negate(guardTruth(expr.operand, rangeOf)) : "unknown";
    }
    if (expr.kind !== "binary") {
        return "unknown";
    }
    if (expr.op === "&&") {
        const left = guardTruth(expr.left, rangeOf);
        const right = guardTruth(expr.right, rangeOf);
        // One certain `false` settles the conjunction whatever the other side does - including when
        // the other side is unreadable, which is the case that makes this worth walking at all.
        if (left === "false" || right === "false") {
            return "false";
        }
        return left === "true" && right === "true" ? "true" : "unknown";
    }
    if (expr.op === "||") {
        const left = guardTruth(expr.left, rangeOf);
        const right = guardTruth(expr.right, rangeOf);
        if (left === "true" || right === "true") {
            return "true";
        }
        return left === "false" && right === "false" ? "false" : "unknown";
    }
    if (!(COMPARISONS as readonly string[]).includes(expr.op)) {
        return "unknown";
    }
    const op = expr.op as ComparisonOp;

    const leftLiteral = numericLiteral(expr.left);
    const rightLiteral = numericLiteral(expr.right);
    if (expr.left.kind === "var" && rightLiteral !== null) {
        const range = rangeOf(storyVariableRefKey(expr.left.target));
        return range?.kind === "known" ? compareRange(range, op, rightLiteral) : "unknown";
    }
    if (expr.right.kind === "var" && leftLiteral !== null) {
        const range = rangeOf(storyVariableRefKey(expr.right.target));
        return range?.kind === "known" ? compareRange(range, MIRRORED[op], leftLiteral) : "unknown";
    }
    return "unknown";
}

/**
 * The comparison each picked operator makes, as the expression operator that makes the same one.
 *
 * Only the six that compare against a value. The compiler answers the four ordered ones through
 * `compareStoryCondition`, which is `compareStoryValues` - the rule `<`, `<=`, `>` and `>=` follow in
 * an expression - and the picked "equals" is the strict equality an expression's `==` is.
 */
const PICKED_COMPARISONS: Partial<Record<Extract<StoryConditionRef, { kind: "variable" }>["operator"], StoryExprBinaryOp>> = {
    equals: "==",
    notEquals: "!=",
    greaterThan: ">",
    greaterOrEqual: ">=",
    lessThan: "<",
    lessOrEqual: "<=",
};

/**
 * The tree {@link guardTruth} reads for a stored condition, whichever editor wrote it, or null when
 * there is nothing for it to read.
 *
 * A condition is stored in one of three shapes, and the one the condition editor's dropdowns write -
 * a variable, an operator, a value - is the shape most conditions in a real project have. Judging
 * only typed expressions would leave nearly every guard an author builds unread, so a picked
 * comparison is rewritten as the tree the same comparison typed as an expression parses to:
 * `好感度 大于或等于 20` picked and `好感度 >= 20` typed are one test, and with one tree there is one
 * evaluator and the two cannot get different verdicts.
 *
 * Null - so the guard is taken - for:
 *
 *  - a graph condition, whose answer is computed inside a blueprint;
 *  - "is true", "is false" and "is set", which ask about a flag rather than a number. The first two
 *    test the stored boolean itself where an expression's `met` / `!met` test truthiness, so writing
 *    them as one would claim an equivalence that does not hold, and nothing numeric could settle them;
 *  - a comparison whose value has not been filled in, which is an unfinished row, not a route.
 */
export function conditionGuardExpr(condition: StoryConditionRef): StoryExpr | null {
    if (condition.kind === "expression") {
        return condition.expression.ast;
    }
    if (condition.kind !== "variable") {
        return null;
    }
    const op = PICKED_COMPARISONS[condition.operator];
    if (!op || condition.value === undefined) {
        return null;
    }
    return {
        kind: "binary",
        op,
        // The name is display-only on a `var` node and nothing on this path displays the tree.
        left: { kind: "var", target: condition.target, name: "" },
        right: { kind: "literal", value: condition.value },
    };
}
