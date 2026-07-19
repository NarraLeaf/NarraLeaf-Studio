import type { StoryLiteralValue, StoryVariableRef } from "./document";

/**
 * The story expression language: the small, total, side-effect-free value language the command line
 * writes and the compiler evaluates.
 *
 * Why an AST rather than a stored string. Three consumers want "a computed value" - a `setVariable`
 * right-hand side, an `if` condition, an inline `{…}` run in dialogue - and all three previously had
 * to reach for a blueprint to add one to a number. A stored string would have to be re-parsed by
 * every consumer (including the compiler, which must not be able to fail on data that already
 * committed), so the *parse* happens once, at authoring time, and the document stores the tree.
 *
 * Why no `eval`. Every node here is interpreted by a plain tree walk (`evaluateStoryExpression`).
 * Nothing in this language can name a host object, so there is no sandbox to escape - which is what
 * makes it shippable where `StoryCodePayload` and `compileProjectBlueprintScripts` are deliberately
 * inert. The function set is a closed whitelist for exactly that reason; adding to it is a language
 * change, not a config change.
 *
 * `source` travels with the tree. The author sees their own text when they re-open the row, and an
 * expression that stops resolving (a variable was deleted) can still be displayed and repaired
 * rather than silently becoming `0`. This is the same bargain the `invalid` block kind strikes.
 */

export type StoryExprBinaryOp =
    | "+" | "-" | "*" | "/" | "%"
    | "==" | "!=" | "<" | "<=" | ">" | ">="
    | "&&" | "||";

export type StoryExprUnaryOp = "-" | "!";

/**
 * The callable whitelist. Deliberately closed and deliberately small: these are the operations an
 * author reaches for while writing a flag or a counter, not a standard library. Anything absent is a
 * signal that the logic belongs in a blueprint.
 */
export const STORY_EXPR_FUNCTIONS = [
    "min", "max", "abs", "round", "floor", "ceil", "clamp",
    "random", "randomInt",
    "len",
] as const;

export type StoryExprFunction = typeof STORY_EXPR_FUNCTIONS[number];

export type StoryExpr =
    | { kind: "literal"; value: StoryLiteralValue }
    /** A resolved variable read. Resolution binds the author's identifier to a ref; the tree never stores a name. */
    | { kind: "var"; target: StoryVariableRef; /** Author-facing name, for display and repair only - never used to resolve. */ name: string }
    | { kind: "unary"; op: StoryExprUnaryOp; operand: StoryExpr }
    | { kind: "binary"; op: StoryExprBinaryOp; left: StoryExpr; right: StoryExpr }
    | { kind: "ternary"; test: StoryExpr; consequent: StoryExpr; alternate: StoryExpr }
    | { kind: "call"; fn: StoryExprFunction; args: StoryExpr[] }
    /**
     * A subtree that did not parse or did not resolve. Kept so a committed expression is never
     * silently rewritten into something the author did not type; the compiler faults on it rather
     * than evaluating around it.
     */
    | { kind: "invalid"; source: string };

/** A stored expression: the tree that compiles, plus the text the author typed. */
export type StoryExpression = {
    source: string;
    ast: StoryExpr;
};

/** Static type of an expression, where knowable. `unknown` where a `json` variable or a mixed branch defeats inference. */
export type StoryExprType = "boolean" | "number" | "string" | "unknown";

export function isStoryExprFunction(name: string): name is StoryExprFunction {
    return (STORY_EXPR_FUNCTIONS as readonly string[]).includes(name);
}

/** Whether the tree contains no `invalid` node - i.e. whether the compiler may evaluate it. */
export function isStoryExpressionEvaluable(expr: StoryExpr): boolean {
    switch (expr.kind) {
        case "invalid":
            return false;
        case "literal":
        case "var":
            return true;
        case "unary":
            return isStoryExpressionEvaluable(expr.operand);
        case "binary":
            return isStoryExpressionEvaluable(expr.left) && isStoryExpressionEvaluable(expr.right);
        case "ternary":
            return isStoryExpressionEvaluable(expr.test)
                && isStoryExpressionEvaluable(expr.consequent)
                && isStoryExpressionEvaluable(expr.alternate);
        case "call":
            return expr.args.every(isStoryExpressionEvaluable);
    }
}

/** Every variable the tree reads, in encounter order, deduped by ref identity. */
export function collectStoryExpressionVariables(expr: StoryExpr): StoryVariableRef[] {
    const found: StoryVariableRef[] = [];
    const seen = new Set<string>();

    const visit = (node: StoryExpr): void => {
        switch (node.kind) {
            case "var": {
                const key = storyVariableRefKey(node.target);
                if (!seen.has(key)) {
                    seen.add(key);
                    found.push(node.target);
                }
                return;
            }
            case "unary":
                visit(node.operand);
                return;
            case "binary":
                visit(node.left);
                visit(node.right);
                return;
            case "ternary":
                visit(node.test);
                visit(node.consequent);
                visit(node.alternate);
                return;
            case "call":
                node.args.forEach(visit);
                return;
            case "literal":
            case "invalid":
                return;
        }
    };

    visit(expr);
    return found;
}

/** A stable string identity for a variable ref, for deduping and map keys. */
export function storyVariableRefKey(ref: StoryVariableRef): string {
    return ref.scope === "persistent" ? `persistent:${ref.storageKey}` : `${ref.scope}:${ref.variableId}`;
}

/** A literal-only expression, the shape `/set gold 100` produces and every legacy value migrates to. */
export function literalExpression(value: StoryLiteralValue, source?: string): StoryExpression {
    return { source: source ?? formatStoryLiteral(value), ast: { kind: "literal", value } };
}

/** Render a literal the way the author would have typed it, so a migrated value round-trips visibly. */
export function formatStoryLiteral(value: StoryLiteralValue): string {
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    if (value === null || typeof value === "boolean" || typeof value === "number") {
        return String(value);
    }
    return JSON.stringify(value);
}
