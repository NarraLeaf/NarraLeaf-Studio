/**
 * Shared editor for a story control-flow condition (`StoryConditionRef`). Two tiers, mirroring the
 * inline value interpolation model (`InterpolationPopover`):
 *  - "Variable": pick a declared scene/saved/persistent variable, an operator, and (when comparing) a
 *    value. Scope is inferred from the chosen variable — the author never picks a scope first.
 *  - "Graph": bind a Story Action Blueprint (owner `storyAction`, mode `condition`) whose boolean
 *    Return Value is evaluated each time the branch is tested. The graph is created lazily on open and
 *    removed again when the author switches back to a variable, so its lifecycle matches variable
 *    evaluation. Internal ids are never shown to the author.
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
import { Input, Select, Switch, type SelectOption } from "@/lib/components/elements";
import { useWorkspace } from "@/apps/workspace/context";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { StoryActionBlueprintPreviewCard } from "./StoryActionBlueprintPreviewCard";
import { collectStoryVariableOptions, type PersistentVariableOption, type StoryVariableOption } from "./storyInterpolation";

type ConditionKind = "variable" | "blueprint";

type VariableCondition = Extract<StoryConditionRef, { kind: "variable" }>;

const DEFAULT_VARIABLE_CONDITION: VariableCondition = {
    kind: "variable",
    target: { scope: "scene", variableId: "" },
    operator: "isTrue",
};

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
    return ref.scope === "persistent" ? `persistent:${ref.storageKey}` : `${ref.scope}:${ref.variableId}`;
}

function makeVariableRef(scope: "scene" | "saved" | "persistent", id: string): StoryVariableRef {
    return scope === "persistent" ? { scope: "persistent", storageKey: id } : { scope, variableId: id };
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

    const kind: ConditionKind = props.value?.kind === "blueprint" ? "blueprint" : "variable";
    const variableValue: VariableCondition = props.value?.kind === "variable" ? props.value : DEFAULT_VARIABLE_CONDITION;
    const blueprintId = props.value?.kind === "blueprint" ? props.value.blueprintId : "";

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
        props.onChange(DEFAULT_VARIABLE_CONDITION);
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
                onChange={value => setKind(value === "blueprint" ? "blueprint" : "variable")}
                size="sm"
                fullWidth
                portalMenu
                menuZIndex={props.menuZIndex}
                menuDataAttributes={props.menuDataAttributes}
            />
            {kind === "variable" ? (
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
