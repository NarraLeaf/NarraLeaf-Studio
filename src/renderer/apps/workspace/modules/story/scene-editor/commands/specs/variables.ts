import { Equal, Minus, Plus, RotateCcw, ToggleRight, Variable } from "lucide-react";
import type { StoryActionPayload, StoryBlock, StoryDeclarationPayload, StoryExpr, StoryExpression, StoryLiteralValue, StoryVariableValueType } from "@shared/types/story";
import { inferStoryExpressionType, storyExprTypeFits } from "@shared/utils/storyExpressionEval";
import { formatStoryExpressionName } from "@shared/utils/storyExpressionParser";
import { APP_TAG_EXPR_KEYWORD, storyVariableRefKey } from "@shared/types/story";
import { createBlockForCommand } from "../../storyActionCommands";
import type { StoryCommandResolutionIssue, StoryCommandValue } from "../../storyCommandValues";
import { defineStoryCommand, type ResolvedArgsOf, type StoryCommandParamSpec, type StoryCommandValidateContext } from "../spec";

/**
 * Variables: `/set` and its sugars `/inc` `/dec` `/toggle` `/reset`, plus the one declaration
 * `/local`.
 *
 * The sugars all lower to the identical `setVariable` block `/set` builds - they differ only in the
 * expression they synthesize - so the compiler and inspector see one shape.
 *
 * There used to be three declarations. `/save` and `/global` are retired: a story document owns
 * `scene` variables and nothing else, and the two project scopes are authored in the project variable
 * registry, which is the only place they can be declared once for a project rather than once per
 * story. See `services/variables/storyDeclarationMigration.ts` for the pass that moves existing rows
 * across. Declaration ROWS of those scopes still RENDER (see {@link DECLARATION_COMMANDS}) - a frozen
 * project cannot be migrated, and its rows must read as themselves in the meantime.
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

/**
 * `/set gold "text"` where `gold` is a number - only checkable once both params have resolved.
 *
 * The issue carries the TARGET's name as well as the expression source. The message names the
 * variable as the thing that holds a type, and the variable is the only side that can be said to hold
 * one - reporting `assigned.source` in that role produced the self-contradicting
 * `This produces string, but "upper("a")" holds number.`
 *
 * That wording was wrong from the day it was written and simply unreachable until this round:
 * `inferStoryExpressionType` used to answer `"number"` for every function call, so a function result
 * always fitted a number variable and `/set gold upper("a")` never reached this branch. The table in
 * `FUNCTION_RESULT_TYPES` made the path live, which is when the sentence first got read.
 */
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
    return span
        ? [{
            code: "expressionTypeMismatch",
            span,
            value: assigned.source,
            variable: target.name,
            expected: target.valueType,
            received: inferred,
        }]
        : [];
}

export const set = defineStoryCommand({
    id: "set",
    token: "set",
    category: "data",
    icon: Equal,
    examples: ["/set gold 100", "/set gold gold + 1", "/set met true"],
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
    icon: Plus,
    examples: ["/inc gold", "/inc gold 5"],
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
    icon: Minus,
    examples: ["/dec gold 5"],
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
    icon: ToggleRight,
    examples: ["/toggle met"],
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
    icon: RotateCcw,
    examples: ["/reset gold"],
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
 * The params a `/local` line takes. Still its own function rather than an inline record: the shape is
 * the *declaration* param set, and it is what the retired `/save` and `/global` took too - a row of
 * either still reads back through these slots (`storyCommandLine`'s `declarationSentence`).
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

/**
 * A name already taken in the scene scope is refused outright - silently overwriting the existing
 * declaration would reset a variable other rows already point at.
 *
 * Scoped to `scene` rather than parameterised, because `scene` is the only scope a story row may
 * still declare. The project scopes get the same protection from the variables panel, over the
 * registry.
 */
function validateSceneDeclaration(args: { readonly name?: StoryCommandValue }, ctx: StoryCommandValidateContext): StoryCommandResolutionIssue[] {
    const name = args.name;
    const span = ctx.spanOf("name");
    if (name?.kind !== "text" || !span) {
        return [];
    }
    const needle = name.value.trim().toLowerCase();
    // The expression language reads `AppTag` as the build variant before it looks at any scope, so a
    // variable of that name could only ever be read as `'AppTag'`. Refused at the declaration rather
    // than left to be discovered at the first line that tries to use it.
    //
    // Only this scope is protected. A `saved` or `persistent` variable is named in the Variables
    // panel, which writes the registry directly and has no validation seam to hang this off - so a
    // name collision there stays possible, and the quoted spelling stays the way to read it.
    if (needle === APP_TAG_EXPR_KEYWORD.toLowerCase()) {
        return [{ code: "reservedVariableName", span, value: name.value }];
    }
    if (ctx.context.variables.some(entry => entry.ref.scope === "scene" && entry.name.trim().toLowerCase() === needle)) {
        return [{ code: "duplicateVariable", span, value: name.value }];
    }
    return [];
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
    const declaredType = args.type?.kind === "enum" ? args.type.value as StoryVariableValueType : undefined;
    // An explicit `type=string` outranks how the value happens to read: `/local x "[1,2]" type=string`
    // asked for the characters, so the source text goes in rather than the list `parseLiteral` made of
    // them. Only `string` is undone, and deliberately so - `/local flag 1 type=bool` has always stored
    // the 1 it was handed, and coercing every default to its declared type is a different change with
    // its own migration question. This one only refuses to CREATE a mismatch the reading introduced.
    const defaultValue = args.default?.kind === "literal"
        ? (declaredType === "string" ? args.default.source : args.default.value)
        : undefined;
    return {
        name,
        // An explicit `type=` wins; otherwise the default's own type is the best evidence available.
        valueType: declaredType ?? inferDeclaredType(defaultValue),
        defaultValue,
        description: args.desc?.kind === "text" && args.desc.value.trim() ? args.desc.value.trim() : undefined,
    };
}

/**
 * The type of a declaration with no explicit `type=`. Boolean is the fallback for a bare
 * `/local met` because a flag is what an author declares without thinking about types at all.
 *
 * The trailing `json` arm was unreachable until `parseLiteral` learned to read a bracketed default:
 * every value it could produce was a string, a number or a boolean. A list or an object now lands
 * here, and lands on the arm that was already waiting for it - `/local inv "[1, 2]"` needs no `type=`.
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
 *
 * That `storageKey === id` identity is load-bearing beyond this file: it is what lets the retirement
 * pass turn a `/save` or `/global` row into a registry entry with the SAME id and storage key, so
 * every ref, scene snapshot and on-disk save file keeps resolving. Do not mint them separately.
 */
function buildSceneDeclaration(args: ResolvedArgsOf<ReturnType<typeof declarationParams>>, ctx: { generateId: () => string }): StoryBlock {
    const id = ctx.generateId();
    const declared = declarationFromArgs(args);
    return {
        id,
        kind: "declaration",
        parentId: null,
        childrenIds: [],
        payload: {
            scope: "scene",
            name: declared?.name ?? "variable",
            valueType: declared?.valueType ?? "boolean",
            defaultValue: declared?.defaultValue,
            description: declared?.description,
            storageKey: id,
        },
    };
}

/**
 * The command each scope's declaration row belongs to.
 *
 * Exported because a declaration row has to be able to name the command that wrote it from the
 * payload alone - the row's glyph asks (`storySceneBlockUtils`), and so does the line the row reads
 * back as (`storyCommandLine`). A second copy of a three-row table is how a scope ends up wearing one
 * command's icon and another command's verb.
 *
 * **All three rows stay, including the two whose commands are retired.** `declareVar` and
 * `declarePersis` no longer resolve to a spec, and that is on purpose: what they still do is keep a
 * `saved` / `persistent` row RENDERING AS ITSELF. A project that is frozen (or whose registry could
 * not be written) still holds those rows, and dropping them from this table would make them fall
 * through to the no-command path and read as an unowned row instead of the declaration they are.
 * Both consumers degrade gracefully on a missing spec: the badge falls back to its own icon, and the
 * line falls back to the retired TOKEN (`retiredCommandToken`, in the registry) so the row reads
 * `/save …` rather than leaking `declareVar` - the ids below are internal names and belong to no
 * author's vocabulary.
 */
export const DECLARATION_COMMANDS: Record<StoryDeclarationPayload["scope"], string> = {
    scene: "declareLocal",
    saved: "declareVar",
    persistent: "declarePersis",
};

export const declareLocal = defineStoryCommand({
    id: "declareLocal",
    token: "local",
    aliases: ["scenevar"],
    category: "data",
    icon: Variable,
    // The json line is quoted because a space still splits a token - quoting is the grouping syntax the
    // command line already has, and the one an author needs for any default with a space in it.
    examples: ["/local hp 100", "/local hp 100 type=number desc='Player health'", "/local inv \"[1, 2]\" type=json"],
    params: declarationParams(),
    build: buildSceneDeclaration,
    validate: validateSceneDeclaration,
});

/**
 * `/local` is the only declaration left.
 *
 * `/save` (aliases `var`, `savedvar`) and `/global` (aliases `persis`, `persistent`) were removed
 * outright - not deprecated, not hidden. A saved or persistent variable is a PROJECT-level
 * definition: it outlives the scene it was typed in and is read by stories and blueprints that have
 * never heard of that scene, so declaring it inside one story document put its single definition
 * somewhere only that document could see. It is authored in the variables panel now.
 *
 * All six spellings are burned into `RESERVED_TOKENS` (`commands/registry.ts`) rather than freed: a
 * scene exported to a script file still holds `/save gold 10 type=number` lines that the importer
 * re-parses verbatim, so a future `/save` meaning anything else would silently reinterpret them.
 */
export const VARIABLE_COMMANDS = [set, inc, dec, toggle, reset, declareLocal];
