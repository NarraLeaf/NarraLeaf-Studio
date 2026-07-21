import type { StoryActionPayload, StoryBlock, StoryExpr, StoryExpression, StoryLiteralValue, StoryVariableValueType } from "@shared/types/story";
import { inferStoryExpressionType, storyExprTypeFits } from "@shared/utils/storyExpressionEval";
import { formatStoryExpressionName } from "@shared/utils/storyExpressionParser";
import { storyVariableRefKey } from "@shared/types/story";
import { createBlockForCommand } from "../../storyActionCommands";
import type { StoryCommandResolutionIssue, StoryCommandValue } from "../../storyCommandValues";
import { defineStoryCommand, type ResolvedArgsOf, type StoryCommandParamSpec, type StoryCommandValidateContext } from "../spec";

/**
 * Variables: `/set` and its sugars `/inc` `/dec` `/toggle` `/reset`, plus the three declarations
 * `/local` `/var` `/persis`.
 *
 * The sugars all lower to the identical `setVariable` block `/set` builds - they differ only in the
 * expression they synthesize - so the compiler and inspector see one shape. The declarations build no
 * block at all: committing one mutates the variable registry and leaves the scene as it was.
 */

const VARIABLE: StoryCommandParamSpec = { hint: "variable", type: { kind: "variable" }, positional: true, core: true };

type SetVariableBlock = Extract<StoryBlock, { kind: "action" }> & { payload: Extract<StoryActionPayload, { action: "setVariable" }> };

function setVariableBase(generateId: () => string, variable: StoryCommandValue | undefined): {
    block: StoryBlock;
    base: SetVariableBlock | null;
    payload: Extract<StoryActionPayload, { action: "setVariable" }> | null;
    self: StoryExpr | null;
    name: string;
} {
    const block = createBlockForCommand("setVariable", generateId);
    if (block.kind !== "action" || block.payload.action !== "setVariable" || variable?.kind !== "variable") {
        return { block, base: null, payload: null, self: null, name: "" };
    }
    return {
        block,
        base: block as SetVariableBlock,
        payload: { ...block.payload, target: variable.ref },
        self: { kind: "var", target: variable.ref, name: variable.name },
        name: variable.name,
    };
}

/**
 * Write a computed right-hand side onto a `setVariable` payload. A tree that is nothing but a
 * literal folds back into `value` and clears `expression` - the inspector's literal editor still
 * binds to it and the compiler takes the direct set path.
 */
function withAssignedExpression(
    payload: Extract<StoryActionPayload, { action: "setVariable" }>,
    expression: StoryExpression,
): Extract<StoryActionPayload, { action: "setVariable" }> {
    if (expression.ast.kind === "literal") {
        return { ...payload, value: expression.ast.value, expression: undefined };
    }
    return { ...payload, expression };
}

/** `/set gold "text"` where `gold` is a number - only checkable once both params have resolved. */
function validateAssignmentType(
    args: { readonly variable?: StoryCommandValue; readonly value?: StoryCommandValue },
    ctx: StoryCommandValidateContext,
): StoryCommandResolutionIssue[] {
    const target = args.variable;
    const assigned = args.value;
    if (target?.kind !== "variable" || assigned?.kind !== "expression") {
        return [];
    }
    const inferred = inferStoryExpressionType(assigned.expression.ast, ref => {
        const key = storyVariableRefKey(ref);
        return ctx.context.variables.find(entry => storyVariableRefKey(entry.ref) === key)?.valueType;
    });
    if (storyExprTypeFits(inferred, target.valueType)) {
        return [];
    }
    const span = ctx.spanOf("value");
    return span ? [{ code: "expressionTypeMismatch", span, value: assigned.source, expected: target.valueType, received: inferred }] : [];
}

export const set = defineStoryCommand({
    id: "set",
    token: "set",
    category: "data",
    params: {
        variable: VARIABLE,
        value: { hint: "expressionValue", type: { kind: "expression", assignTo: "variable" }, positional: true, greedy: true, core: true },
    },
    build(args, ctx) {
        const { block, base, payload } = setVariableBase(ctx.generateId, args.variable);
        if (!base || !payload) {
            return block;
        }
        if (args.value?.kind === "expression") {
            return { ...base, payload: withAssignedExpression(payload, args.value.expression) };
        }
        if (args.value?.kind === "literal") {
            return { ...base, payload: { ...payload, value: args.value.value } };
        }
        return { ...base, payload };
    },
    validate: validateAssignmentType,
});

function buildIncDec(op: "+" | "-", args: { readonly variable?: StoryCommandValue; readonly by?: StoryCommandValue }, generateId: () => string): StoryBlock {
    const { block, base, payload, self, name } = setVariableBase(generateId, args.variable);
    if (!base || !payload || !self) {
        return block;
    }
    // `by` defaults to 1: `/inc gold` is the line this command exists for. The trees are built
    // directly rather than re-parsed, so a variable name containing an operator cannot break them.
    const step: StoryExpr = args.by?.kind === "expression" ? args.by.expression.ast : { kind: "literal", value: 1 };
    const stepSource = args.by?.kind === "expression" ? args.by.source : "1";
    return {
        ...base,
        payload: {
            ...payload,
            // The stored source must re-parse: a spaced name prints in its quoted entity form.
            expression: { source: `${formatStoryExpressionName(name)} ${op} (${stepSource})`, ast: { kind: "binary", op, left: self, right: step } },
        },
    };
}

export const inc = defineStoryCommand({
    id: "inc",
    token: "inc",
    aliases: ["add"],
    category: "data",
    params: {
        variable: VARIABLE,
        by: { hint: "amount", type: { kind: "expression" }, positional: true, greedy: true },
    },
    build: (args, ctx) => buildIncDec("+", args, ctx.generateId),
});

export const dec = defineStoryCommand({
    id: "dec",
    token: "dec",
    aliases: ["sub"],
    category: "data",
    params: {
        variable: VARIABLE,
        by: { hint: "amount", type: { kind: "expression" }, positional: true, greedy: true },
    },
    build: (args, ctx) => buildIncDec("-", args, ctx.generateId),
});

export const toggle = defineStoryCommand({
    id: "toggle",
    token: "toggle",
    aliases: ["flip"],
    category: "data",
    params: { variable: VARIABLE },
    build(args, ctx) {
        const { block, base, payload, self, name } = setVariableBase(ctx.generateId, args.variable);
        if (!base || !payload || !self) {
            return block;
        }
        return {
            ...base,
            payload: { ...payload, expression: { source: `!${formatStoryExpressionName(name)}`, ast: { kind: "unary", op: "!", operand: self } } },
        };
    },
});

export const reset = defineStoryCommand({
    id: "reset",
    token: "reset",
    category: "data",
    params: { variable: VARIABLE },
    build(args, ctx) {
        const { block, base, payload } = setVariableBase(ctx.generateId, args.variable);
        if (!base || !payload || args.variable?.kind !== "variable") {
            return block;
        }
        // Resetting assigns the declared default, snapshotted here rather than resolved at runtime:
        // NLR has no "restore to default" action, and a row that silently changed meaning when someone
        // edited the declaration would be worse than one that says what it assigns.
        return {
            ...base,
            payload: { ...payload, value: args.variable.defaultValue ?? defaultForType(args.variable.valueType), expression: undefined },
        };
    },
});

/** The zero value of a type - what a variable declared without an explicit default holds. */
export function defaultForType(valueType: StoryVariableValueType): StoryLiteralValue {
    switch (valueType) {
        case "boolean":
            return false;
        case "number":
            return 0;
        case "string":
            return "";
        case "json":
            return null;
    }
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

/**
 * The params every `/local` `/var` `/persis` line takes - identical across all three, because the
 * only thing that differs between them is the scope, and the scope is the command name.
 *
 * `default` is a {@link StoryCommandParamType constant}, not an expression: a declaration runs once,
 * before any variable exists, so a slot offering variables would complete straight into an error.
 * Deliberately **not** greedy, or it would swallow the `type=` in `/local hp 100 type=number`.
 */
function declarationParams() {
    return {
        name: { hint: "variableName", type: { kind: "text" }, positional: true, core: true },
        default: { aliases: ["value"], hint: "defaultValue", type: { kind: "constant" }, positional: true },
        type: {
            aliases: ["as"],
            hint: "valueType",
            type: {
                kind: "enum",
                options: [
                    { value: "boolean", aliases: ["bool", "flag"] },
                    { value: "number", aliases: ["num", "int"] },
                    { value: "string", aliases: ["str", "text"] },
                    { value: "json", aliases: ["object", "list"] },
                ],
            },
        },
        desc: { aliases: ["note"], hint: "description", type: { kind: "text" } },
    } as const;
}

/** A name already taken in the target scope is refused outright - silently overwriting the existing declaration would reset a variable other rows already point at. */
function validateDeclaration(scope: "scene" | "saved" | "persistent") {
    return (args: { readonly name?: StoryCommandValue }, ctx: StoryCommandValidateContext): StoryCommandResolutionIssue[] => {
        const name = args.name;
        const span = ctx.spanOf("name");
        if (name?.kind !== "text" || !span) {
            return [];
        }
        const needle = name.value.trim().toLowerCase();
        if (ctx.context.variables.some(entry => entry.ref.scope === scope && entry.name.trim().toLowerCase() === needle)) {
            return [{ code: "duplicateVariable", span, value: name.value }];
        }
        return [];
    };
}

/**
 * The variable a declaration line declares, derived from its resolved args. Pure and exported so a
 * test can pin the whole line to the declaration it produces - the bug class this guards against is
 * a default read under the wrong kind silently declaring the wrong type.
 */
export function declarationFromArgs(args: Readonly<Record<string, StoryCommandValue | undefined>>): {
    name: string;
    valueType: StoryVariableValueType;
    defaultValue: StoryLiteralValue | undefined;
    description: string | undefined;
} | null {
    const name = args.name?.kind === "text" ? args.name.value.trim() : "";
    if (!name) {
        return null;
    }
    const defaultValue = args.default?.kind === "literal" ? args.default.value : undefined;
    return {
        name,
        // An explicit `type=` wins; otherwise the default's own type is the best evidence available.
        valueType: args.type?.kind === "enum" ? args.type.value as StoryVariableValueType : inferDeclaredType(defaultValue),
        defaultValue,
        description: args.desc?.kind === "text" && args.desc.value.trim() ? args.desc.value.trim() : undefined,
    };
}

/**
 * The type of a declaration with no explicit `type=`. Boolean is the fallback for a bare
 * `/local met` because a flag is what an author declares without thinking about types at all.
 */
function inferDeclaredType(defaultValue: StoryLiteralValue | undefined): StoryVariableValueType {
    if (typeof defaultValue === "number") {
        return "number";
    }
    if (typeof defaultValue === "string") {
        return "string";
    }
    if (typeof defaultValue === "boolean" || defaultValue === undefined) {
        return "boolean";
    }
    return "json";
}

/**
 * A declaration builds a ROW (schema v6): the row is the variable - visible in the scene like every
 * other line, its overview names it, Enter/double-click opens its type/default editor, and deleting
 * it deletes the variable. `storageKey` is the block's own id, minted here so the key exists before
 * the row lands.
 */
function buildDeclaration(scope: "scene" | "saved" | "persistent") {
    return (args: ResolvedArgsOf<ReturnType<typeof declarationParams>>, ctx: { generateId: () => string }): StoryBlock => {
        const id = ctx.generateId();
        const declared = declarationFromArgs(args);
        return {
            id,
            kind: "declaration",
            parentId: null,
            childrenIds: [],
            payload: {
                scope,
                name: declared?.name ?? "variable",
                valueType: declared?.valueType ?? "boolean",
                defaultValue: declared?.defaultValue,
                description: declared?.description,
                storageKey: id,
            },
        };
    };
}

export const declareLocal = defineStoryCommand({
    id: "declareLocal",
    token: "local",
    aliases: ["scenevar"],
    category: "data",
    params: declarationParams(),
    build: buildDeclaration("scene"),
    validate: validateDeclaration("scene"),
});

export const declareVar = defineStoryCommand({
    id: "declareVar",
    token: "var",
    aliases: ["savedvar"],
    category: "data",
    params: declarationParams(),
    build: buildDeclaration("saved"),
    validate: validateDeclaration("saved"),
});

export const declarePersis = defineStoryCommand({
    id: "declarePersis",
    token: "persis",
    aliases: ["persistent", "global"],
    category: "data",
    params: declarationParams(),
    build: buildDeclaration("persistent"),
    validate: validateDeclaration("persistent"),
});

export const VARIABLE_COMMANDS = [set, inc, dec, toggle, reset, declareLocal, declareVar, declarePersis];
