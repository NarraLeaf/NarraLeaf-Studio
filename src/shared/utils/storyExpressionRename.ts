import {
    APP_TAG_EXPR_KEYWORD,
    isStoryVisitedCall,
    storyVariableRefKey,
    type StoryExpr,
    type StoryExpression,
    type StoryVariableRef,
} from "@shared/types/story";
import {
    formatStoryExpr,
    formatStoryExpressionName,
    lexStoryExpression,
    parseStoryExpression,
    type StoryExpressionScope,
    type StoryExpressionToken,
} from "./storyExpressionParser";

/**
 * Rewrite one reference inside a stored expression, for the rename refactor.
 *
 * A stored expression is a tree that resolves by id plus the text the author typed. Renaming a
 * variable or a scene leaves the tree correct and the text wrong: the row still compiles, but the
 * line shows the old name and the next edit of it re-parses that old name into "no variable named
 * gold". So a rename rewrites the text, and it has to do it without touching anything else the author
 * typed - spacing, parentheses, the order of operands.
 *
 * # How a token is matched to the reference it produced
 *
 * Not by name. Two variables can share a name across scopes (`gold` and `saved.gold`), and a source
 * may carry a name the declaration has since lost (a rename made before this refactor existed). The
 * tree knows which reference each read resolved to; the tokens know where each read sits. The parser
 * reads identifiers left to right and the tree's in-order walk visits its leaves in the same order, so
 * the n-th variable token is the n-th `var` node. That pairing is checked rather than trusted: the
 * rewritten text is parsed again, with each read answered from the original tree in order, and must
 * produce the original tree with only the renamed names changed. When it does not, the tree is printed
 * instead (`formatStoryExpr`, which parenthesises eagerly), and when even that does not round-trip the
 * site is reported as one this refactor cannot rewrite.
 */

export type StoryExpressionRenameTarget =
    | { kind: "variable"; ref: StoryVariableRef; newName: string }
    | { kind: "scene"; sceneId: string; newName: string };

export type StoryExpressionRenameResult =
    /** The expression does not reference the target. */
    | { status: "unchanged" }
    | {
          status: "rewritten";
          expression: StoryExpression;
          occurrences: number;
          /** The author's text could not be kept and the tree was printed instead. */
          reformatted: boolean;
      }
    /** It references the target and neither rewrite round-trips. */
    | { status: "failed"; occurrences: number };

type Leaves = {
    vars: Extract<StoryExpr, { kind: "var" }>[];
    visited: Extract<StoryExpr, { kind: "visited" }>[];
    invokes: Extract<StoryExpr, { kind: "invoke" }>[];
};

/** Every reference leaf, in source order. */
function collectLeaves(expr: StoryExpr, into: Leaves = { vars: [], visited: [], invokes: [] }): Leaves {
    switch (expr.kind) {
        case "var":
            into.vars.push(expr);
            break;
        case "visited":
            into.visited.push(expr);
            break;
        case "invoke":
            into.invokes.push(expr);
            break;
        case "unary":
            collectLeaves(expr.operand, into);
            break;
        case "binary":
            collectLeaves(expr.left, into);
            collectLeaves(expr.right, into);
            break;
        case "ternary":
            collectLeaves(expr.test, into);
            collectLeaves(expr.consequent, into);
            collectLeaves(expr.alternate, into);
            break;
        case "call":
            expr.args.forEach(arg => collectLeaves(arg, into));
            break;
        case "array":
            expr.items.forEach(item => collectLeaves(item, into));
            break;
        case "index":
            collectLeaves(expr.target, into);
            collectLeaves(expr.index, into);
            break;
        case "literal":
        case "invalid":
            break;
    }
    return into;
}

function matchesTarget(expr: StoryExpr, target: StoryExpressionRenameTarget): boolean {
    if (target.kind === "variable") {
        return expr.kind === "var" && storyVariableRefKey(expr.target) === storyVariableRefKey(target.ref);
    }
    return expr.kind === "visited" && expr.target.kind === "scene" && expr.target.sceneId === target.sceneId;
}

/** The tree with the target's display names replaced - what the rewritten text must parse back to. */
function renameTree(expr: StoryExpr, target: StoryExpressionRenameTarget): StoryExpr {
    if (matchesTarget(expr, target)) {
        return { ...expr, name: target.newName } as StoryExpr;
    }
    switch (expr.kind) {
        case "unary":
            return { ...expr, operand: renameTree(expr.operand, target) };
        case "binary":
            return { ...expr, left: renameTree(expr.left, target), right: renameTree(expr.right, target) };
        case "ternary":
            return {
                ...expr,
                test: renameTree(expr.test, target),
                consequent: renameTree(expr.consequent, target),
                alternate: renameTree(expr.alternate, target),
            };
        case "call":
            return { ...expr, args: expr.args.map(arg => renameTree(arg, target)) };
        case "array":
            return { ...expr, items: expr.items.map(item => renameTree(item, target)) };
        case "index":
            return { ...expr, target: renameTree(expr.target, target), index: renameTree(expr.index, target) };
        default:
            return expr;
    }
}

type TokenRole = "var" | "visitedArg" | "other";

/** Which tokens the parser will read as a variable, and which as a `visited(…)` / `picked(…)` argument. */
function classifyTokens(tokens: readonly StoryExpressionToken[]): TokenRole[] {
    return tokens.map((token, index) => {
        if (token.type !== "identifier") {
            return "other";
        }
        const next = tokens[index + 1];
        const callee = next?.type === "punct" && next.text === "(";
        const previous = tokens[index - 1];
        const beforePrevious = tokens[index - 2];
        if (
            previous?.type === "punct" && previous.text === "("
            && beforePrevious?.type === "identifier" && !beforePrevious.quoted && isStoryVisitedCall(beforePrevious.text)
        ) {
            return "visitedArg";
        }
        if (token.quoted) {
            return callee ? "other" : "var";
        }
        const lowered = token.text.toLowerCase();
        if (lowered === "true" || lowered === "false" || lowered === "null" || lowered === APP_TAG_EXPR_KEYWORD.toLowerCase()) {
            return "other";
        }
        return callee ? "other" : "var";
    });
}

/**
 * A scope that answers every read from the original tree, in order: the n-th variable read gets the
 * n-th `var` node's reference, whatever it is called now. What makes the round-trip check about the
 * text's shape rather than about which names the project happens to declare.
 */
function replayScope(leaves: Leaves): StoryExpressionScope {
    let varAt = 0;
    let visitedAt = 0;
    const next = () => leaves.vars[varAt++]?.target ?? null;
    const normalize = (name: string) => name.trim().toLowerCase();
    return {
        lookup: () => next(),
        lookupIn: () => next(),
        lookupVisited: () => {
            const node = leaves.visited[visitedAt++];
            if (!node) {
                return null;
            }
            return { id: node.target.kind === "scene" ? node.target.sceneId : node.target.blockId };
        },
        lookupBlueprint: name => {
            const node = leaves.invokes.find(invoke => normalize(invoke.name) === normalize(name));
            return node ? { id: node.blueprintId } : null;
        },
    };
}

function roundTrips(source: string, original: Leaves, expected: StoryExpr): boolean {
    const parsed = parseStoryExpression(source, replayScope(original));
    return JSON.stringify(parsed.expression.ast) === JSON.stringify(expected);
}

/** How a renamed token is spelled. Null when the spelling cannot be kept (a quoted name behind a scope prefix). */
function spellToken(token: StoryExpressionToken, newName: string, role: TokenRole): string | null {
    const formatted = formatStoryExpressionName(newName);
    if (role === "var" && !token.quoted) {
        const dot = token.text.indexOf(".");
        if (dot > 0) {
            // `saved.gold` keeps its prefix; a name that needs quoting has no prefixed spelling.
            return formatted === newName ? `${token.text.slice(0, dot)}.${newName}` : null;
        }
    }
    return formatted;
}

/** Rewrite every reference to `target` in `expression`, keeping the rest of the text as typed. */
export function renameInStoryExpression(
    expression: StoryExpression,
    target: StoryExpressionRenameTarget,
): StoryExpressionRenameResult {
    const leaves = collectLeaves(expression.ast);
    const hits = target.kind === "variable"
        ? leaves.vars.filter(node => matchesTarget(node, target)).length
        : leaves.visited.filter(node => matchesTarget(node, target)).length;
    if (hits === 0) {
        return { status: "unchanged" };
    }
    const expected = renameTree(expression.ast, target);

    const tokens = lexStoryExpression(expression.source);
    const roles = classifyTokens(tokens);
    const varTokens = tokens.filter((_, index) => roles[index] === "var");
    const visitedTokens = tokens.filter((_, index) => roles[index] === "visitedArg");

    if (varTokens.length === leaves.vars.length && visitedTokens.length === leaves.visited.length) {
        const replacements: { start: number; end: number; text: string }[] = [];
        let spellable = true;
        const pair = (list: readonly StoryExpressionToken[], nodes: readonly StoryExpr[], role: TokenRole) => {
            list.forEach((token, index) => {
                if (!matchesTarget(nodes[index], target)) {
                    return;
                }
                const text = spellToken(token, target.newName, role);
                if (text === null) {
                    spellable = false;
                    return;
                }
                replacements.push({ start: token.span.start, end: token.span.end, text });
            });
        };
        if (target.kind === "variable") {
            pair(varTokens, leaves.vars, "var");
        } else {
            pair(visitedTokens, leaves.visited, "visitedArg");
        }
        if (spellable) {
            let source = expression.source;
            for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
                source = source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
            }
            if (roundTrips(source, leaves, expected)) {
                return { status: "rewritten", expression: { source, ast: expected }, occurrences: hits, reformatted: false };
            }
        }
    }

    const printed = formatStoryExpr(expected);
    if (roundTrips(printed, leaves, expected)) {
        return { status: "rewritten", expression: { source: printed, ast: expected }, occurrences: hits, reformatted: true };
    }
    return { status: "failed", occurrences: hits };
}
