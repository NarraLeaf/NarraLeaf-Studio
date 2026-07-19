import type { StoryLiteralValue, StoryVariableRef, StoryVariableValueType } from "@shared/types/story";
import type { StoryExpr, StoryExprType } from "@shared/types/story/expression";

/**
 * Evaluator and type inference for the story expression language.
 *
 * Total by construction: every node has a defined result for every input, so evaluation cannot throw
 * and a story cannot crash mid-scene because a variable held the wrong shape. Where JavaScript would
 * produce `NaN` or `Infinity` this returns a value an author can actually see on screen without it
 * reading as a bug. That choice is the whole reason not to reuse JS semantics wholesale.
 *
 * Deliberate departures from JavaScript, each because the author-facing failure mode is better:
 *
 *  - `==` / `!=` are strict. `"1" == 1` is false. Coercion equality is a bug factory in a language
 *    whose values come from typed variable declarations.
 *  - `&&` / `||` evaluate to booleans, not to the surviving operand. Short-circuiting is preserved,
 *    but `name || "Stranger"` does not mean "default" here - `name != "" ? name : "Stranger"` does.
 *    Predictable result types matter more than the idiom in a system that statically checks an
 *    assignment against a declared `valueType`.
 *  - Division (and modulo) by zero is `0`, not `Infinity`/`NaN`. An `Infinity` reaching a dialogue
 *    line is worse than a wrong-but-finite number, and both are bugs the author must fix anyway.
 *  - `+` concatenates when either side is a string, adds when both are numbers. This is the one
 *    JS-shaped coercion kept, because `"第 " + chapter + " 章"` is the single most common thing an
 *    author writes.
 */

/** Reads a variable's current value. `undefined` means "not present", which evaluates as the type's zero. */
export type StoryExpressionReader = (ref: StoryVariableRef) => StoryLiteralValue | undefined;

export function evaluateStoryExpression(expr: StoryExpr, read: StoryExpressionReader): StoryLiteralValue {
    switch (expr.kind) {
        case "literal":
            return expr.value;

        case "var":
            return read(expr.target) ?? null;

        case "invalid":
            // Never reached in a compiled story - the compiler refuses a tree containing one - but a
            // preview may still walk a half-repaired expression, and `null` is the quiet answer.
            return null;

        case "unary": {
            const operand = evaluateStoryExpression(expr.operand, read);
            return expr.op === "!" ? !isTruthy(operand) : -toNumber(operand);
        }

        case "ternary":
            return isTruthy(evaluateStoryExpression(expr.test, read))
                ? evaluateStoryExpression(expr.consequent, read)
                : evaluateStoryExpression(expr.alternate, read);

        case "binary":
            return evaluateBinary(expr, read);

        case "call":
            return evaluateCall(expr, read);
    }
}

function evaluateBinary(expr: Extract<StoryExpr, { kind: "binary" }>, read: StoryExpressionReader): StoryLiteralValue {
    // Short-circuit before evaluating the right operand: `has_key && chest_count > 0` must not read
    // the second variable when the first is false, matching every expectation an author brings.
    if (expr.op === "&&") {
        return isTruthy(evaluateStoryExpression(expr.left, read))
            && isTruthy(evaluateStoryExpression(expr.right, read));
    }
    if (expr.op === "||") {
        return isTruthy(evaluateStoryExpression(expr.left, read))
            || isTruthy(evaluateStoryExpression(expr.right, read));
    }

    const left = evaluateStoryExpression(expr.left, read);
    const right = evaluateStoryExpression(expr.right, read);

    switch (expr.op) {
        case "+":
            return typeof left === "string" || typeof right === "string"
                ? toDisplayString(left) + toDisplayString(right)
                : toNumber(left) + toNumber(right);
        case "-":
            return toNumber(left) - toNumber(right);
        case "*":
            return toNumber(left) * toNumber(right);
        case "/": {
            const divisor = toNumber(right);
            return divisor === 0 ? 0 : toNumber(left) / divisor;
        }
        case "%": {
            const divisor = toNumber(right);
            return divisor === 0 ? 0 : toNumber(left) % divisor;
        }
        case "==":
            return strictEquals(left, right);
        case "!=":
            return !strictEquals(left, right);
        case "<":
            return compare(left, right) < 0;
        case "<=":
            return compare(left, right) <= 0;
        case ">":
            return compare(left, right) > 0;
        case ">=":
            return compare(left, right) >= 0;
    }
}

function evaluateCall(expr: Extract<StoryExpr, { kind: "call" }>, read: StoryExpressionReader): StoryLiteralValue {
    const args = expr.args.map(arg => evaluateStoryExpression(arg, read));
    const numbers = args.map(toNumber);

    switch (expr.fn) {
        case "min":
            return Math.min(...numbers);
        case "max":
            return Math.max(...numbers);
        case "abs":
            return Math.abs(numbers[0]);
        case "round":
            return Math.round(numbers[0]);
        case "floor":
            return Math.floor(numbers[0]);
        case "ceil":
            return Math.ceil(numbers[0]);
        case "clamp": {
            const [value, low, high] = numbers;
            // Tolerate a reversed range rather than returning something outside both bounds.
            const lower = Math.min(low, high);
            const upper = Math.max(low, high);
            return Math.min(Math.max(value, lower), upper);
        }
        case "random":
            return Math.random();
        case "randomInt": {
            // Inclusive on both ends: `randomInt(1, 6)` is a die, which is what an author means.
            const low = Math.ceil(Math.min(numbers[0], numbers[1]));
            const high = Math.floor(Math.max(numbers[0], numbers[1]));
            return high < low ? low : low + Math.floor(Math.random() * (high - low + 1));
        }
        case "len": {
            const value = args[0];
            if (typeof value === "string") {
                return [...value].length;
            }
            if (Array.isArray(value)) {
                return value.length;
            }
            if (value && typeof value === "object") {
                return Object.keys(value).length;
            }
            return 0;
        }
    }
}

// ── Coercion ──────────────────────────────────────────────────────────────────────────────────────

export function isTruthy(value: StoryLiteralValue): boolean {
    if (value === null || value === false) {
        return false;
    }
    if (typeof value === "number") {
        return value !== 0 && !Number.isNaN(value);
    }
    if (typeof value === "string") {
        return value !== "";
    }
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    return true;
}

function toNumber(value: StoryLiteralValue): number {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    if (typeof value === "string") {
        const parsed = Number(value.trim());
        return value.trim() !== "" && Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

/** How a value reads on screen. `null` is empty rather than the literal word "null". */
export function toDisplayString(value: StoryLiteralValue): string {
    if (value === null) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    return JSON.stringify(value);
}

function strictEquals(left: StoryLiteralValue, right: StoryLiteralValue): boolean {
    if (typeof left !== typeof right) {
        return false;
    }
    if (left !== null && right !== null && typeof left === "object") {
        // Structural, so two equal-looking json variables compare equal - reference identity is not a
        // concept the author has any way to reason about here.
        return JSON.stringify(left) === JSON.stringify(right);
    }
    return left === right;
}

/** Ordering for the relational operators: numeric when both sides are numeric, lexicographic for strings. */
function compare(left: StoryLiteralValue, right: StoryLiteralValue): number {
    if (typeof left === "string" && typeof right === "string") {
        return left < right ? -1 : left > right ? 1 : 0;
    }
    const a = toNumber(left);
    const b = toNumber(right);
    return a < b ? -1 : a > b ? 1 : 0;
}

// ── Static type inference ─────────────────────────────────────────────────────────────────────────

/**
 * The type an expression will produce, where derivable.
 *
 * Used to check an assignment against the target's declared `valueType` before the row commits, so
 * `/set gold "rich"` faults at authoring time rather than writing a string into a number variable and
 * surfacing three scenes later. Returns `unknown` wherever inference would have to guess - a `json`
 * variable, or a ternary whose branches disagree - and callers treat `unknown` as "allow", because a
 * false rejection is far more expensive than a missed check.
 */
export function inferStoryExpressionType(
    expr: StoryExpr,
    typeOf: (ref: StoryVariableRef) => StoryVariableValueType | undefined,
): StoryExprType {
    switch (expr.kind) {
        case "literal": {
            const value = expr.value;
            if (typeof value === "boolean") {
                return "boolean";
            }
            if (typeof value === "number") {
                return "number";
            }
            return typeof value === "string" ? "string" : "unknown";
        }

        case "var": {
            const declared = typeOf(expr.target);
            return declared === undefined || declared === "json" ? "unknown" : declared;
        }

        case "invalid":
            return "unknown";

        case "unary":
            return expr.op === "!" ? "boolean" : "number";

        case "ternary": {
            const consequent = inferStoryExpressionType(expr.consequent, typeOf);
            const alternate = inferStoryExpressionType(expr.alternate, typeOf);
            return consequent === alternate ? consequent : "unknown";
        }

        case "call":
            return "number";

        case "binary": {
            switch (expr.op) {
                case "==": case "!=": case "<": case "<=": case ">": case ">=": case "&&": case "||":
                    return "boolean";
                case "-": case "*": case "/": case "%":
                    return "number";
                case "+": {
                    const left = inferStoryExpressionType(expr.left, typeOf);
                    const right = inferStoryExpressionType(expr.right, typeOf);
                    if (left === "string" || right === "string") {
                        return "string";
                    }
                    // Only claim `number` when both sides are known non-strings; an `unknown` operand
                    // could still be a string and turn the whole thing into concatenation.
                    return left === "unknown" || right === "unknown" ? "unknown" : "number";
                }
            }
        }
    }
}

/** Whether an expression's inferred type may be assigned to a variable of the declared type. */
export function storyExprTypeFits(inferred: StoryExprType, declared: StoryVariableValueType): boolean {
    if (declared === "json" || inferred === "unknown") {
        return true;
    }
    return inferred === declared;
}
