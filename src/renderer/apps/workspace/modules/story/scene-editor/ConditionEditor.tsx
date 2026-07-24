/**
 * Shared editor for a story control-flow condition (`StoryConditionRef`). Three tiers, in order of
 * how much they let the author say:
 *  - "Expression": type a boolean expression against declared variables (`gold >= 100 && !met`). The
 *    general case, and the same thing `/if` writes from the command line — so a condition typed as a
 *    command and one built here are the same object, and each can edit the other's work.
 *  - "Variable": pick a declared scene/saved/persistent variable, an operator, and (when comparing) a
 *    value. Strictly less expressive than an expression, kept because dropdowns are discoverable in a
 *    way a syntax is not. Scope is inferred from the chosen variable — the author never picks a scope.
 *  - "Graph": bind a Story Action Blueprint (owner `storyAction`, mode `condition`) whose boolean
 *    Return Value is evaluated each time the branch is tested. The graph is created lazily on open and
 *    removed again when the author switches away, so its lifecycle matches variable evaluation.
 *    Internal ids are never shown to the author.
 *
 * The tiers only ever change on an explicit switch. That is not a nicety: before expressions had a
 * tier here, an `expression` condition fell through to "Variable", rendered as a *blank* variable
 * condition, and the first edit overwrote it — so opening the inspector on `/if gold >= 100` silently
 * destroyed it. Any future fourth kind must add a case to {@link conditionKindOf} for the same reason.
 */

import { useEffect, useMemo, useState } from "react";
import type {
    StoryConditionRef,
    StoryDocument,
    StoryLiteralValue,
    StorySceneId,
    StoryVariableRef,
    StoryVariableValueType,
} from "@shared/types/story";
import { formatStoryLiteral } from "@shared/types/story";
import type { TranslationKey } from "@shared/i18n";
import type { StoryExpressionScope } from "@shared/utils/storyExpressionParser";
import { createStoryExpressionScope, parseStoryExpression } from "@shared/utils/storyExpressionParser";
import { Input, Select, Switch, type SelectOption } from "@/lib/components/elements";
import { useWorkspace } from "@/apps/workspace/context";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { StoryActionBlueprintPreviewCard } from "./StoryActionBlueprintPreviewCard";
import { collectStoryVariableOptions, type PersistentVariableOption, type StoryVariableOption } from "./storyInterpolation";

type ConditionKind = "expression" | "variable" | "blueprint";

type VariableCondition = Extract<StoryConditionRef, { kind: "variable" }>;

const DEFAULT_VARIABLE_CONDITION: VariableCondition = {
    kind: "variable",
    target: { scope: "scene", variableId: "" },
    operator: "isTrue",
};

/** An empty expression condition — `invalid` until the author types something that parses. */
const EMPTY_EXPRESSION_CONDITION: StoryConditionRef = {
    kind: "expression",
    expression: { source: "", ast: { kind: "invalid", source: "" } },
};

/**
 * Which tier a stored condition belongs to.
 *
 * Total over `StoryConditionRef["kind"]` on purpose. The previous form of this was a ternary that
 * treated everything not `blueprint` as `variable`, which is how an expression condition ended up
 * being rendered — and then overwritten — as a blank variable condition.
 */
export function conditionKindOf(value: StoryConditionRef | undefined): ConditionKind {
    switch (value?.kind) {
        case "blueprint":
            return "blueprint";
        case "expression":
            return "expression";
        case "variable":
            return "variable";
        default:
            // A brand-new condition. Expressions are the general tier and what `/if` produces, so a
            // condition created here starts in the same place a condition created by typing does.
            return "expression";
    }
}

/** Read persistent variables (shared blueprint store) and keep them live. */
function usePersistentVariables(): PersistentVariableOption[] {
    const { context, isInitialized } = useWorkspace();
    const [persistent, setPersistent] = useState<PersistentVariableOption[]>([]);
    useEffect(() => {
        if (!context || !isInitialized) return;
        const service = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const read = () =>
            setPersistent(
                service.listPersistentVariables().map(variable => ({
                    storageKey: variable.storageKey,
                    name: variable.name,
                    valueType: (variable.valueType as StoryVariableValueType) ?? "string",
                })),
            );
        read();
        return service.onBlueprintHistoryChanged(read);
    }, [context, isInitialized]);
    return persistent;
}

function flattenVariables(options: {
    scene: StoryVariableOption[];
    saved: StoryVariableOption[];
    persistent: StoryVariableOption[];
}) {
    return [
        ...options.scene.map(v => ({ key: `scene:${v.id}`, scope: "scene" as const, id: v.id, name: v.name, valueType: v.valueType })),
        ...options.saved.map(v => ({ key: `saved:${v.id}`, scope: "saved" as const, id: v.id, name: v.name, valueType: v.valueType })),
        ...options.persistent.map(v => ({ key: `persistent:${v.id}`, scope: "persistent" as const, id: v.id, name: v.name, valueType: v.valueType })),
    ];
}

function variableRefKey(ref: StoryVariableRef): string {
    return `${ref.scope}:${ref.variableId}`;
}

function makeVariableRef(scope: "scene" | "saved" | "persistent", id: string): StoryVariableRef {
    return { scope, variableId: id };
}

export function ConditionEditor(props: {
    document: StoryDocument;
    sceneId: StorySceneId;
    value: StoryConditionRef | undefined;
    onChange: (condition: StoryConditionRef | undefined) => void;
    /** Menu z-index for portalled Select menus (popover contexts need a high value). */
    menuZIndex?: number;
    menuDataAttributes?: Record<`data-${string}`, string>;
    /** Called right before navigating to the blueprint editor, so the caller can commit/close. */
    onBeforeOpenBlueprint?: () => void;
}) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const openBlueprint = useOpenBlueprintTarget();
    const kindOptions: SelectOption[] = useMemo(() => [
        // Expression leads: it is the general tier, the one `/if` writes, and the only one that can
        // express "gold >= 100 && !met" at all.
        { value: "expression", label: t("story.condition.kindExpression") },
        { value: "variable", label: t("story.interpolation.kindVariable") },
        { value: "blueprint", label: t("story.condition.kindGraph") },
    ], [t]);
    const operatorOptions: SelectOption[] = useMemo(() => [
        { value: "isTrue", label: t("story.condition.opIsOn") },
        { value: "isFalse", label: t("story.condition.opIsOff") },
        { value: "equals", label: t("story.condition.opEquals") },
        { value: "notEquals", label: t("story.condition.opNotEquals") },
        { value: "exists", label: t("story.condition.opExists") },
    ], [t]);
    const blueprintService = useMemo(
        () => (context && isInitialized ? context.services.get<LocalBlueprintService>(Services.LocalBlueprint) : null),
        [context, isInitialized],
    );
    const persistent = usePersistentVariables();
    const variableOptions = useMemo(
        () => collectStoryVariableOptions(props.document, props.sceneId, persistent),
        [props.document, props.sceneId, persistent],
    );
    const allVariables = useMemo(() => flattenVariables(variableOptions), [variableOptions]);

    const kind = conditionKindOf(props.value);
    const variableValue: VariableCondition = props.value?.kind === "variable" ? props.value : DEFAULT_VARIABLE_CONDITION;
    const blueprintId = props.value?.kind === "blueprint" ? props.value.blueprintId : "";
    const expressionSource = props.value?.kind === "expression" ? props.value.expression.source : "";

    /** The scope an expression's identifiers resolve through — the same three scopes, same precedence. */
    const expressionScope = useMemo(
        () => createStoryExpressionScope(allVariables.map(option => ({ name: option.name, ref: makeVariableRef(option.scope, option.id) }))),
        [allVariables],
    );

    const currentValueType: StoryVariableValueType =
        allVariables.find(option => variableRefKey(variableValue.target) === option.key)?.valueType ?? "string";

    const setKind = (nextKind: ConditionKind) => {
        if (nextKind === kind) {
            return;
        }
        if (nextKind === "blueprint") {
            // Do NOT create the blueprint here — creating mutates the document and re-renders the row,
            // dropping this uncommitted switch. It is created lazily on open (mirrors interpolation).
            props.onChange({ kind: "blueprint", blueprintId: "" });
            return;
        }
        // Leaving the graph tier: drop the now-unused condition blueprint so it does not linger.
        if (blueprintId) {
            blueprintService?.removeStoryActionBlueprint(blueprintId);
        }
        if (nextKind === "expression") {
            // Switching from the variable picker carries the comparison across rather than blanking
            // the field: the author asked for "the same test, as text", not for a fresh start.
            props.onChange(
                kind === "variable"
                    ? expressionFromVariableCondition(variableValue, allVariables, expressionScope)
                    : EMPTY_EXPRESSION_CONDITION,
            );
            return;
        }
        props.onChange(DEFAULT_VARIABLE_CONDITION);
    };

    const setExpressionSource = (source: string) => {
        // Re-parsed on every keystroke. Cheap (the language is tiny), and it means the stored tree is
        // never out of step with the text beside it — the invariant the compiler leans on.
        props.onChange({ kind: "expression", expression: parseStoryExpression(source, expressionScope).expression });
    };

    const setVariableByKey = (key: string) => {
        const option = allVariables.find(v => v.key === key);
        if (!option) return;
        props.onChange({ ...variableValue, target: makeVariableRef(option.scope, option.id) });
    };

    const openEditor = () => {
        let id = blueprintId;
        if (!id) {
            id = blueprintService?.ensureStoryActionBlueprint({ mode: "condition" }) ?? "";
            props.onChange({ kind: "blueprint", blueprintId: id });
        }
        if (!id) {
            return;
        }
        props.onBeforeOpenBlueprint?.();
        openBlueprint({ blueprintId: id, ownerKind: "storyAction", title: t("story.condition.title") });
    };

    const variableSelectOptions: SelectOption[] = allVariables.length
        ? allVariables.map(option => ({ value: option.key, label: option.name, secondaryLabel: option.valueType }))
        : [{ value: "", label: t("story.interpolation.noVariables") }];

    const showValueField = variableValue.operator === "equals" || variableValue.operator === "notEquals";

    return (
        <div className="flex flex-col gap-2">
            <Select
                options={kindOptions}
                value={kind}
                onChange={value => setKind(value as ConditionKind)}
                size="sm"
                fullWidth
                portalMenu
                menuZIndex={props.menuZIndex}
                menuDataAttributes={props.menuDataAttributes}
            />
            {kind === "expression" ? (
                <ConditionExpressionField
                    source={expressionSource}
                    scope={expressionScope}
                    variableNames={allVariables.map(option => option.name)}
                    onChange={setExpressionSource}
                />
            ) : kind === "variable" ? (
                <>
                    <Select
                        options={variableSelectOptions}
                        value={variableRefKey(variableValue.target)}
                        onChange={value => setVariableByKey(String(value))}
                        placeholder={t("story.interpolation.selectVariable")}
                        size="sm"
                        fullWidth
                        portalMenu
                        menuZIndex={props.menuZIndex}
                        menuDataAttributes={props.menuDataAttributes}
                    />
                    <Select
                        options={operatorOptions}
                        value={variableValue.operator}
                        onChange={value =>
                            props.onChange({ ...variableValue, operator: value as VariableCondition["operator"] })
                        }
                        size="sm"
                        fullWidth
                        portalMenu
                        menuZIndex={props.menuZIndex}
                        menuDataAttributes={props.menuDataAttributes}
                    />
                    {showValueField ? (
                        <ConditionValueField
                            valueType={currentValueType}
                            value={variableValue.value ?? ""}
                            onChange={next => props.onChange({ ...variableValue, value: next })}
                        />
                    ) : null}
                </>
            ) : (
                <StoryActionBlueprintPreviewCard
                    blueprintId={blueprintId}
                    onOpen={openEditor}
                    variant="detailed"
                    ariaLabel={blueprintId ? t("story.condition.openGraphAria") : t("story.condition.createGraphAria")}
                />
            )}
        </div>
    );
}

/**
 * The expression tier: a text field that re-parses as you type, plus the first thing that went wrong.
 *
 * Errors are shown but never block editing — a half-typed `gold >` is an ordinary intermediate state,
 * not a mistake, so it earns a quiet note rather than a red field. What it does not do is let a
 * non-boolean through silently: a condition that is not a comparison is almost always unfinished, the
 * same rule `/if` applies, so it says so.
 */
function ConditionExpressionField(props: {
    source: string;
    scope: StoryExpressionScope;
    variableNames: readonly string[];
    onChange: (source: string) => void;
}) {
    const { t } = useTranslation();
    const parsed = useMemo(() => parseStoryExpression(props.source, props.scope), [props.scope, props.source]);
    const problem = props.source.trim() === ""
        ? null
        : parsed.issues[0]
            ? t(`storyExpr.issue.${parsed.issues[0].code}` as TranslationKey)
            : null;

    return (
        <div className="flex flex-col gap-1">
            <Input
                value={props.source}
                onChange={event => props.onChange(event.target.value)}
                placeholder={t("story.condition.expressionPlaceholder")}
                size="sm"
                fullWidth
                className="font-mono"
            />
            {problem ? (
                <p className="text-2xs text-warning">{problem}</p>
            ) : (
                /* With no error there is still something worth saying: which names are in scope. That
                   is the one thing a text field cannot show and a dropdown gets for free. */
                <p className="truncate text-2xs text-fg-subtle">
                    {props.variableNames.length
                        ? t("story.condition.expressionVariables", { names: props.variableNames.slice(0, 6).join(", ") })
                        : t("story.interpolation.noVariables")}
                </p>
            )}
        </div>
    );
}

/**
 * Rewrite a variable-picker condition as the expression text that means the same thing, so switching
 * tiers keeps the author's work instead of blanking the field.
 *
 * Falls back to an empty expression when the picker was never filled in — there is no honest text for
 * "no variable chosen", and inventing one would put a broken expression in front of the author.
 */
function expressionFromVariableCondition(
    condition: VariableCondition,
    variables: readonly { key: string; name: string }[],
    scope: StoryExpressionScope,
): StoryConditionRef {
    const name = variables.find(option => option.key === variableRefKey(condition.target))?.name;
    if (!name) {
        return EMPTY_EXPRESSION_CONDITION;
    }
    const literal = formatStoryLiteral(condition.value ?? null);
    const source =
        condition.operator === "isTrue" ? name
            : condition.operator === "isFalse" ? `!${name}`
                : condition.operator === "equals" ? `${name} == ${literal}`
                    : condition.operator === "notEquals" ? `${name} != ${literal}`
                        : `${name} != null`;
    return { kind: "expression", expression: parseStoryExpression(source, scope).expression };
}

/** Value input whose control matches the compared variable's declared type. */
function ConditionValueField(props: {
    valueType: StoryVariableValueType;
    value: StoryLiteralValue;
    onChange: (value: StoryLiteralValue) => void;
}) {
    const { t } = useTranslation();
    if (props.valueType === "boolean") {
        return (
            <label className="flex items-center gap-2 text-sm text-fg-muted">
                <Switch checked={props.value === true} onCheckedChange={checked => props.onChange(checked)} />
                <span>{props.value === true ? t("story.condition.valueTrue") : t("story.condition.valueFalse")}</span>
            </label>
        );
    }
    if (props.valueType === "number") {
        return (
            <Input
                type="number"
                size="sm"
                fullWidth
                value={typeof props.value === "number" ? String(props.value) : ""}
                onChange={event => {
                    const next = Number(event.target.value);
                    props.onChange(Number.isFinite(next) ? next : 0);
                }}
            />
        );
    }
    return (
        <Input
            size="sm"
            fullWidth
            value={String(props.value ?? "")}
            placeholder={t("story.condition.valuePlaceholder")}
            onChange={event => props.onChange(event.target.value)}
        />
    );
}
