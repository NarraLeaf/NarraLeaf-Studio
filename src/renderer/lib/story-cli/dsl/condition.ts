/**
 * Conditions, both ways: a stored `StoryConditionRef` as expression source, and source back again.
 *
 * ## Why the round trip matters more here than anywhere else
 *
 * A condition is stored in one of three shapes. `expression` holds the source an author typed;
 * `blueprint` computes the answer in a graph and has no text at all; and `variable` is the shape the
 * condition PICKER writes - a variable, one of nine operators, and a value. In a real project that
 * third shape is 81 of 82 conditions, because clicking through the picker is how a branch is
 * normally made.
 *
 * So a format that could only spell `expression` conditions could not write an `/if` at all. Both
 * directions are therefore implemented: {@link conditionSource} lowers the picker's shape to text,
 * and {@link conditionFromSource} raises text back to it whenever the text is one of the comparison
 * shapes the picker can hold.
 *
 * ## Raising is a preference, not a guess
 *
 * A source that parses to `variable op literal` becomes a `variable` condition; anything else stays
 * an `expression`. The choice is observable - the two open in different editors in Studio, and
 * mapping a stored condition onto the wrong one is a documented way to destroy an author's work
 * (`conditionKind.test.ts`) - which is exactly why the preference reproduces the shape the row
 * already had rather than normalising every condition to one kind.
 *
 * Nothing here has to be trusted, and that is the point: every line the printer writes is read back
 * and compared before it is kept (`print.ts`), so a condition these two functions disagree about
 * becomes a preserved opaque row rather than a rewritten one.
 *
 * Comments in English per project convention.
 */

import type {
    StoryConditionRef,
    StoryExpr,
    StoryExpression,
    StoryLiteralValue,
    StoryVariableRef,
} from "@shared/types/story";
import { formatStoryLiteral } from "@shared/types/story";
import {
    formatStoryExpressionName,
    isAdvisoryStoryExpressionIssue,
    parseStoryExpression,
    type StoryExpressionScope,
} from "@shared/utils/storyExpressionParser";

/** Naming what a condition points at. Only variables: the other two shapes name nothing. */
export type ConditionLookups = {
    variableName: (ref: StoryVariableRef) => string | null;
};

/** The nine picker operators against the binary spelling each one writes. `null` where there is none. */
const OPERATOR_SPELLING: Readonly<Record<string, string | null>> = {
    isTrue: null,
    isFalse: null,
    equals: "==",
    notEquals: "!=",
    greaterThan: ">",
    greaterOrEqual: ">=",
    lessThan: "<",
    lessOrEqual: "<=",
    // No spelling: the expression language has no existence test, so a condition using it has no
    // source and is preserved verbatim instead.
    exists: null,
};

const SPELLING_OPERATOR: Readonly<Record<string, string>> = {
    "==": "equals",
    "!=": "notEquals",
    ">": "greaterThan",
    ">=": "greaterOrEqual",
    "<": "lessThan",
    "<=": "lessOrEqual",
};

/**
 * A condition as the text a branch line carries, or null when it has none.
 *
 * Null for a blueprint-backed condition, whose meaning lives in a graph document, and for the two
 * picker operators no expression spells.
 */
export function conditionSource(
    ref: StoryConditionRef | undefined,
    lookups: ConditionLookups,
): string | null {
    if (!ref) {
        return null;
    }
    if (ref.kind === "blueprint") {
        return null;
    }
    if (ref.kind === "expression") {
        return ref.expression.source;
    }
    const name = lookups.variableName(ref.target);
    if (name === null) {
        // A variable that resolves to nothing has no name to write. The row keeps its binding by
        // being preserved rather than printed with an identifier in it.
        return null;
    }
    const printed = formatStoryExpressionName(name);
    if (ref.operator === "isTrue") {
        return printed;
    }
    if (ref.operator === "isFalse") {
        return `!${printed}`;
    }
    const spelling = OPERATOR_SPELLING[ref.operator];
    return spelling ? `${printed} ${spelling} ${formatStoryLiteral(ref.value ?? null)}` : null;
}

/**
 * Expression source as the condition it means.
 *
 * The parse is the same one the command line runs, so a name resolves here exactly as it resolves
 * when typed into Studio, and an unresolvable name is an issue rather than a silently unbound
 * reference.
 */
export function conditionFromSource(
    source: string,
    scope: StoryExpressionScope,
): { ok: true; condition: StoryConditionRef } | { ok: false; message: string } {
    const parsed = parseStoryExpression(source, scope);
    const blocking = parsed.issues.filter(issue => !isAdvisoryStoryExpressionIssue(issue));
    if (blocking.length > 0) {
        return { ok: false, message: `${blocking[0].code} in "${source.trim()}"` };
    }
    const raised = asVariableCondition(parsed.expression);
    return { ok: true, condition: raised ?? { kind: "expression", expression: parsed.expression } };
}

/**
 * The picker shape this tree spells, or null when no picker could hold it.
 *
 * Three shapes and no more, because those are the three the picker writes: a bare variable, a
 * negated one, and a comparison against a literal. `gold > hp` compares two variables and stays an
 * expression, which is right - the picker has no second variable slot.
 */
function asVariableCondition(expression: StoryExpression): StoryConditionRef | null {
    const ast = expression.ast;
    if (ast.kind === "var") {
        return { kind: "variable", target: ast.target, operator: "isTrue" };
    }
    if (ast.kind === "unary" && ast.op === "!" && ast.operand.kind === "var") {
        return { kind: "variable", target: ast.operand.target, operator: "isFalse" };
    }
    if (ast.kind !== "binary") {
        return null;
    }
    const operator = SPELLING_OPERATOR[ast.op];
    if (!operator || ast.left.kind !== "var" || ast.right.kind !== "literal") {
        return null;
    }
    return {
        kind: "variable",
        target: ast.left.target,
        operator: operator as Extract<StoryConditionRef, { kind: "variable" }>["operator"],
        value: literalOf(ast.right),
    };
}

function literalOf(node: Extract<StoryExpr, { kind: "literal" }>): StoryLiteralValue {
    return node.value;
}
