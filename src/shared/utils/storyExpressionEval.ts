import { RELEASE_APP_TAG } from "@shared/types/appTag";
import type { StoryLiteralValue, StoryVariableRef, StoryVariableValueType } from "@shared/types/story";
import type { StoryExpr, StoryExprFunction, StoryExprType, StoryVisitedRef } from "@shared/types/story/expression";

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
 *
 * Three rules the collection and string functions all obey, and none of them may break:
 *
 *  1. **Total.** Out of range is `null` (or `get`'s explicit default), a missing key is `null`, and a
 *     value of the wrong shape is coerced by the same `toNumber`/`toDisplayString` the operators use
 *     or read as that shape's zero (`[]`, `{}`, `""`). Nothing here can throw, which is what lets a
 *     compiled story evaluate an expression mid-scene with no error path to take.
 *  2. **Pure.** `push` / `setKey` / `removeAt` / `removeKey` return a NEW value and never touch their
 *     argument. An expression is a value, not a statement: the language has no path assignment
 *     (`/set inv[0] x` does not exist and is not wanted), so the only way a mutation could land is
 *     `/set inv push(inv, "x")` - which writes the whole variable back, exactly as it already does
 *     for numbers. Mutating in place would additionally corrupt the *snapshot* copies the scene
 *     preview holds, since those share structure with the live storable.
 *     The copies are SHALLOW, and that is sufficient: nothing in the language can reach into a nested
 *     value and change it either - every writer here rebuilds the one level it is asked to change and
 *     shares the rest - so no caller can observe the sharing.
 *  3. **Deterministic.** Not one of these consults a clock or an RNG. `random`/`randomInt` remain the
 *     only two impure entries in the whitelist, and the lint rule in `rules/variables.ts` polices
 *     where those may sit; adding a third would silently widen that rule's blind spot.
 */

/** Reads a variable's current value. `undefined` means "not present", which evaluates as the type's zero. */
export type StoryExpressionReader = (ref: StoryVariableRef) => StoryLiteralValue | undefined;

/**
 * Answers `visited(…)` / `picked(…)` out of the host's visited record.
 *
 * `name` is the author's own spelling, along for the ride purely so a host that CANNOT answer can say
 * which scene or option it could not answer for. Resolution goes through the ref and only the ref -
 * a host that keyed off the name would reintroduce the rename fragility the node exists to remove.
 */
export type StoryExpressionVisitedReader = (ref: StoryVisitedRef, name: string) => boolean;

/**
 * Runs one `mode:"value"` story blueprint and hands back its `Return Value`. `name` is display-only,
 * for the same reason as above.
 *
 * May throw - graph execution throws all over (`BlueprintGraphExecutionError`, `executeGraphSync`) -
 * and the `invoke` case below is where that is caught. `undefined` is a legitimate quiet answer for
 * a graph that returned nothing.
 */
export type StoryExpressionInvoker = (blueprintId: string, name: string) => StoryLiteralValue | undefined;

/**
 * Everything an expression may reach outside its own tree, in one object.
 *
 * Collected rather than passed as three positional callbacks, and NOT imported: this module is in
 * `shared/` and the two new capabilities live in the renderer's game runtime (the NLR `Storable`, the
 * blueprint graph executor). Importing either here would drag the game runtime into every consumer of
 * the expression language - including the command line and the document migration, neither of which
 * has a game. Injection is the same split the parser already makes with `StoryExpressionScope`, and
 * an object keeps the next capability from being a fourth positional argument nobody can read at the
 * call site.
 *
 * `read` was the whole of this signature before and stays required; folding it in rather than leaving
 * it beside the object is what stops there being two conventions for the same idea.
 *
 * The two capabilities are OPTIONAL, and what that means is load-bearing: absent is "this host cannot
 * answer", not "the answer is no". A host that omits one gets the type's zero, exactly as the catch
 * below does - but a host that CAN be wrong in a way the author would notice (the scene preview) is
 * expected to pass a callback that says so in a diagnostic rather than to omit it. Omission is for
 * hosts that never evaluate at all.
 */
export type StoryExpressionEnv = {
    read: StoryExpressionReader;
    visited?: StoryExpressionVisitedReader;
    invoke?: StoryExpressionInvoker;
};

export function evaluateStoryExpression(expr: StoryExpr, env: StoryExpressionEnv): StoryLiteralValue {
    switch (expr.kind) {
        case "literal":
            return expr.value;

        case "var":
            return env.read(expr.target) ?? null;

        case "invalid":
            // Never reached in a compiled story - the compiler refuses a tree containing one - but a
            // preview may still walk a half-repaired expression, and `null` is the quiet answer.
            return null;

        case "unary": {
            const operand = evaluateStoryExpression(expr.operand, env);
            return expr.op === "!" ? !isTruthy(operand) : -toNumber(operand);
        }

        case "ternary":
            return isTruthy(evaluateStoryExpression(expr.test, env))
                ? evaluateStoryExpression(expr.consequent, env)
                : evaluateStoryExpression(expr.alternate, env);

        case "binary":
            return evaluateBinary(expr, env);

        case "call":
            return evaluateCall(expr, env);

        case "array":
            return expr.items.map(item => evaluateStoryExpression(item, env));

        case "index":
            return elementAt(
                evaluateStoryExpression(expr.target, env),
                evaluateStoryExpression(expr.index, env),
                null,
            );

        case "visited":
            // A record that cannot be read is "not visited", never an error - and that is the same
            // answer `isStoryVisited` gives for a namespace that does not exist yet, so the two
            // cannot disagree about a story played from its first line.
            return env.visited ? env.visited(expr.target, expr.name) : false;

        case "invoke":
            return evaluateInvoke(expr, env);
    }
}

/**
 * Run one blueprint and read its `Return Value`, or answer `null`.
 *
 * **The catch is here, inside the node, and it must stay here.** `evaluateStoryExpression` is total by
 * construction - `storyExpression.test.ts` asserts it cannot throw, and all five of its callers are
 * written on that promise (a compiled `Script`, an NLR dynamic word, a condition lambda, and two
 * preview walks, none of which has an error path to take mid-scene). A blueprint graph, by contrast,
 * throws freely. Wrapping the five CALLERS instead would move the failure out of the language and
 * make the invariant a convention every future caller has to remember; wrapping it here keeps the
 * promise a property of the function. This is the same trade `storyCompiler.ts` already makes two
 * lines wide for its blueprint interpolation (`catch → ""`) and blueprint condition (`catch → false`).
 *
 * `null` rather than `0` or `""`: `invoke` infers as `unknown` because the graph's return type is the
 * author's to change, and `null` is this language's absent value in every other position too.
 */
function evaluateInvoke(expr: Extract<StoryExpr, { kind: "invoke" }>, env: StoryExpressionEnv): StoryLiteralValue {
    if (!env.invoke) {
        return null;
    }
    try {
        return env.invoke(expr.blueprintId, expr.name) ?? null;
    } catch {
        return null;
    }
}

function evaluateBinary(expr: Extract<StoryExpr, { kind: "binary" }>, env: StoryExpressionEnv): StoryLiteralValue {
    // Short-circuit before evaluating the right operand: `has_key && chest_count > 0` must not read
    // the second variable when the first is false, matching every expectation an author brings.
    if (expr.op === "&&") {
        return isTruthy(evaluateStoryExpression(expr.left, env))
            && isTruthy(evaluateStoryExpression(expr.right, env));
    }
    if (expr.op === "||") {
        return isTruthy(evaluateStoryExpression(expr.left, env))
            || isTruthy(evaluateStoryExpression(expr.right, env));
    }

    const left = evaluateStoryExpression(expr.left, env);
    const right = evaluateStoryExpression(expr.right, env);

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

function evaluateCall(expr: Extract<StoryExpr, { kind: "call" }>, env: StoryExpressionEnv): StoryLiteralValue {
    const args = expr.args.map(arg => evaluateStoryExpression(arg, env));
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
            // Already the size of whatever it is handed: code points for a string, elements for a
            // list, keys for a dictionary. Anything else has no length, and `0` is the honest answer.
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

        // ── Collections ───────────────────────────────────────────────────────────────────────────
        // Arity is already enforced by the parser's FUNCTION_ARITY table, so positional reads below
        // are safe; `args.length` is only consulted where an argument is genuinely optional.

        case "list":
            // `args` is already a fresh array, but `.slice()` says so at the call site rather than
            // relying on `expr.args.map` having built one.
            return args.slice();
        case "dict":
            return {};
        case "get":
            // The only function with an author-supplied miss value. Absent means `null`, which is
            // what the `[…]` subscript form gives - `get` exists for when that is not good enough.
            return elementAt(args[0], args[1], args.length >= 3 ? args[2] : null);
        case "keys":
            // Dictionary keys, in insertion order. A list has indices rather than keys, and answering
            // `["0", "1"]` there would invite `get(arr, keys(arr)[0])` - a string index into a list.
            return Object.keys(asDict(args[0]));

        case "push":
            return [...asList(args[0]), args[1]];
        case "removeAt": {
            const list = asList(args[0]);
            const at = toIndex(args[1]);
            // Out of range removes nothing rather than removing the last item: an off-by-one in the
            // author's arithmetic should not silently eat data.
            return at < 0 || at >= list.length ? list.slice() : [...list.slice(0, at), ...list.slice(at + 1)];
        }
        case "setKey":
            return { ...asDict(args[0]), [toDisplayString(args[1])]: args[2] };
        case "removeKey": {
            const dict = { ...asDict(args[0]) };
            delete dict[toDisplayString(args[1])];
            return dict;
        }

        case "hasKey":
            // Dictionary keys only, matching `keys`. A list is asked `indexOf`/`contains` instead.
            return Object.prototype.hasOwnProperty.call(asDict(args[0]), toDisplayString(args[1]));
        case "indexOf": {
            const haystack = args[0];
            if (Array.isArray(haystack)) {
                return haystack.findIndex(item => strictEquals(item, args[1]));
            }
            if (typeof haystack === "string") {
                const at = haystack.indexOf(toDisplayString(args[1]));
                // Re-expressed in code points so the number agrees with `len` and `slice`; a UTF-16
                // offset would be off by one per astral character and only in some strings.
                return at < 0 ? -1 : [...haystack.slice(0, at)].length;
            }
            return -1;
        }
        case "contains": {
            const haystack = args[0];
            if (Array.isArray(haystack)) {
                return haystack.some(item => strictEquals(item, args[1]));
            }
            if (typeof haystack === "string") {
                return haystack.includes(toDisplayString(args[1]));
            }
            if (haystack !== null && typeof haystack === "object") {
                // A dictionary's CONTENTS are its values; its keys are the addresses, and `hasKey`
                // asks about those. Two spellings of the same question would be the worse design.
                return Object.values(haystack).some(item => strictEquals(item, args[1]));
            }
            return false;
        }
        case "join":
            return asList(args[0]).map(toDisplayString).join(toDisplayString(args[1]));
        case "slice": {
            const start = toIndex(args[1]);
            // Absent end means "to the end", which is what `undefined` does to `Array.prototype.slice`.
            const end = args.length >= 3 ? toIndex(args[2]) : undefined;
            const source = args[0];
            if (typeof source === "string") {
                // By code point, like `len`, so `slice(name, 0, len(name))` is the whole string even
                // when it holds an emoji.
                return [...source].slice(start, end).join("");
            }
            // Negative offsets count from the end, as they do in JS - the one JS behaviour worth
            // keeping here, because `slice(log, -3)` ("the last three") is the reason to reach for it.
            return asList(source).slice(start, end);
        }
        case "concat": {
            const [left, right] = args;
            const leftIsDict = left !== null && typeof left === "object" && !Array.isArray(left);
            const rightIsDict = right !== null && typeof right === "object" && !Array.isArray(right);
            if (leftIsDict && rightIsDict) {
                // Right wins a collision, matching `setKey`'s "the new value replaces the old".
                return { ...asDict(left), ...asDict(right) };
            }
            if (Array.isArray(left) || Array.isArray(right)) {
                return [...toItems(left), ...toItems(right)];
            }
            // Neither side is a collection, so this is the string case - `concat` on two scalars is
            // `+` with the concatenation forced, which is exactly why `str` and `num` also exist.
            return toDisplayString(left) + toDisplayString(right);
        }

        // ── Strings ───────────────────────────────────────────────────────────────────────────────

        case "upper":
            return toDisplayString(args[0]).toUpperCase();
        case "lower":
            return toDisplayString(args[0]).toLowerCase();
        case "trim":
            return toDisplayString(args[0]).trim();
        case "replace": {
            const needle = toDisplayString(args[1]);
            // Empty needle returns the source untouched. JS would splice the replacement between
            // every character, which is an artifact of `split("")` rather than anything an author
            // asked for - and a half-typed `replace(s, "", x)` should not rewrite the whole line.
            if (needle === "") {
                return toDisplayString(args[0]);
            }
            // Every occurrence, not the first: `replaceAll` is what "replace" means to someone who
            // has not read a JS spec, and the first-only form has no name they would look for.
            return toDisplayString(args[0]).split(needle).join(toDisplayString(args[2]));
        }
        case "split": {
            const separator = toDisplayString(args[1]);
            const text = toDisplayString(args[0]);
            // Empty separator splits into code points rather than JS's UTF-16 units, so
            // `join(split(s, ""), "")` is `s` for every string, not just the BMP ones.
            return separator === "" ? [...text] : text.split(separator);
        }
        case "pad": {
            const text = toDisplayString(args[0]);
            const chars = [...text];
            const fill = args.length >= 3 ? toDisplayString(args[2]) : "0";
            // Clamped, because totality is not only "does not throw": `pad(1, 1e9)` would build a
            // gigabyte string and hang the scene, which the author would read as a crash anyway.
            const width = Math.min(toIndex(args[1]), MAX_PAD_WIDTH);
            if (fill === "" || width <= chars.length) {
                return text;
            }
            const fillChars = [...fill];
            const padding: string[] = [];
            while (padding.length < width - chars.length) {
                // Cycles a multi-character fill and stops exactly at the requested width, so
                // `pad(7, 5, "ab")` is "abab7" rather than overshooting past `width`.
                padding.push(fillChars[padding.length % fillChars.length]);
            }
            // Left pad only: the ask is a zero-padded number ("007"), and a right pad would need its
            // own name rather than a flag nobody would find.
            return padding.join("") + text;
        }
        case "str":
            return toDisplayString(args[0]);
        case "num":
            return toNumber(args[0]);

        case "appTag":
            // Only reachable where no package is being produced: the transform in
            // `@shared/story/appTagFold` replaces every `AppTag` with the variant's name before a
            // bundle is assembled, and the build refuses anything it could not replace. What is left
            // is an editor preview, which is the project's own values - the release variant.
            return RELEASE_APP_TAG.name;
    }
}

/** Widest string `pad` will build. See the `pad` case: this is a totality guard, not a format limit. */
const MAX_PAD_WIDTH = 4096;

/**
 * One subscript, shared by the `[…]` node and by `get` - so `inv[0]` and `get(inv, 0)` can never
 * disagree, and the only difference between them is what a miss produces.
 *
 * Lists take a number, dictionaries take a key, strings take a code-point offset (agreeing with
 * `len` and `slice`), and anything else has no elements at all. Every miss is the caller's fallback.
 */
function elementAt(collection: StoryLiteralValue, key: StoryLiteralValue, fallback: StoryLiteralValue): StoryLiteralValue {
    if (Array.isArray(collection)) {
        const at = toIndex(key);
        // No negative indexing here, unlike `slice`. A subscript is usually a computed counter, and
        // an arithmetic slip that produced `-1` should read as "no such element" rather than quietly
        // handing back the last one.
        return at >= 0 && at < collection.length ? collection[at] : fallback;
    }
    if (typeof collection === "string") {
        const chars = [...collection];
        const at = toIndex(key);
        return at >= 0 && at < chars.length ? chars[at] : fallback;
    }
    if (collection !== null && typeof collection === "object") {
        const name = toDisplayString(key);
        return Object.prototype.hasOwnProperty.call(collection, name) ? collection[name] : fallback;
    }
    return fallback;
}

/** A value read as a list: itself when it is one, the empty list otherwise. Never a copy of nothing. */
function asList(value: StoryLiteralValue): StoryLiteralValue[] {
    return Array.isArray(value) ? value : [];
}

/** A value read as a dictionary. Lists are excluded on purpose - they are addressed by index. */
function asDict(value: StoryLiteralValue): Record<string, StoryLiteralValue> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, StoryLiteralValue>
        : {};
}

/**
 * A value read as list *items*, for `concat`'s mixed case: a list contributes its elements, `null`
 * contributes nothing (so `concat(inv, null)` is `inv`), and any other scalar contributes itself as
 * one element - which is what an author writing `concat(inv, "key")` plainly meant.
 */
function toItems(value: StoryLiteralValue): StoryLiteralValue[] {
    if (Array.isArray(value)) {
        return value;
    }
    return value === null ? [] : [value];
}

/** An index or a width: a whole number, with the language's usual coercions and no NaN escaping. */
function toIndex(value: StoryLiteralValue): number {
    return Math.trunc(toNumber(value));
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

/**
 * Strict, structural equality for story literals - the one the expression evaluator's `==` uses. No
 * coercion (`"1" == 1` is false), and json/array values compare by shape rather than reference, since
 * reference identity is not something an author can reason about. Exported so the compiler's persistent
 * conditions can test against exactly the same rule as `/if` expressions.
 */
export function strictEquals(left: StoryLiteralValue, right: StoryLiteralValue): boolean {
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
 * What each whitelisted function produces, where the lattice can say it.
 *
 * A table rather than the old blanket `"number"`, which was true while every function was arithmetic
 * and became a lie the moment `upper(name)` existed - it would have let `/set gold upper(name)`
 * through the assignment check and written a string into a number variable, the exact failure
 * `inferStoryExpressionType` exists to catch.
 *
 * The collection results are `unknown` because `StoryExprType` has no list or dictionary arm, and
 * `unknown` is read as "allow" everywhere. Adding those arms would let the check reject
 * `/set gold list(1)` too, but it would also have to be right about every polymorphic case
 * (`slice` and `concat` return a string OR a list depending on their input, `get` returns whatever
 * was stored), and a false rejection is far more expensive here than a missed one.
 */
const FUNCTION_RESULT_TYPES: Readonly<Record<StoryExprFunction, StoryExprType>> = {
    min: "number", max: "number", abs: "number", round: "number", floor: "number", ceil: "number",
    clamp: "number", random: "number", randomInt: "number", len: "number",
    indexOf: "number", num: "number",
    hasKey: "boolean", contains: "boolean",
    join: "string", upper: "string", lower: "string", trim: "string", replace: "string",
    // A variant's name, so `/set edition AppTag` fits a string variable and `AppTag == "Demo"`
    // infers boolean like any other string comparison.
    pad: "string", str: "string", appTag: "string",
    list: "unknown", dict: "unknown", get: "unknown", keys: "unknown",
    push: "unknown", removeAt: "unknown", setKey: "unknown", removeKey: "unknown",
    split: "unknown", slice: "unknown", concat: "unknown",
};

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
            return FUNCTION_RESULT_TYPES[expr.fn];

        case "visited":
            // A membership test, so always a boolean - which is what lets `/set met_her visited(序章)`
            // commit against a boolean variable without the lattice having to guess.
            return "boolean";

        case "invoke":
            // `unknown`, and deliberately not the graph's declared return type: that type is the
            // author's to change in the blueprint editor at any time, with nothing rechecking the
            // expressions that call it. Claiming `number` here would be the same lie the old blanket
            // `case "call": return "number"` was before it became a table - it would pass an
            // assignment check that the runtime then contradicts. `unknown` reads as "allow".
            return "unknown";

        case "array":
        case "index":
            // A list has no arm in this lattice (see `StoryExprType`), and an element's type is not
            // knowable without knowing what is in the collection - so both are `unknown`, which
            // `storyExprTypeFits` treats as assignable anywhere. That is the point: the only variable
            // a list *should* go into is a `json` one, and `json` already accepts everything.
            return "unknown";

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

/**
 * Whether an expression's inferred type may be assigned to a variable of the declared type.
 *
 * A `json` variable accepts anything - which is what makes `/set inv push(inv, "key")` commit
 * without the lattice needing a list arm: the collection functions infer as `unknown`, and both
 * halves of the first line below already say yes.
 */
export function storyExprTypeFits(inferred: StoryExprType, declared: StoryVariableValueType): boolean {
    if (declared === "json" || inferred === "unknown") {
        return true;
    }
    return inferred === declared;
}
