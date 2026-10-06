/**
 * Page parameters in the inspector: declaring them on a page, and the one field that edits a value of
 * any of their kinds - a declared default here, a Page widget's value in the widget's inspector.
 *
 * The page's counterpart of `ComponentParamsEditor`, and laid out the same way: one row per
 * parameter, its name and kind on the first line and its default under them - or, for a list, the
 * shape of its rows, since a list starts empty.
 *
 * Comments in English per project convention.
 */

import { Plus, X } from "lucide-react";
import { Select, Switch } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import type { UIPageParam, UIPageParamType } from "@shared/types/ui-editor/document";
import {
    UI_PAGE_PARAM_TYPES,
    coerceUIPageParamValue,
    getUIPageParams,
    nextUIPageParamId,
    uiPageParamDefaultValue,
} from "@shared/types/ui-editor/pageParams";
import type { TranslationKey } from "@shared/i18n";
import { listEngineUIStructIds } from "@shared/types/ui-editor/builtinStructs";
import { blueprintStructName } from "@/lib/ui-editor/blueprint-nodes/structTypeLabels";
import { DraftInput } from "./ComponentParamsEditor";
import type { CustomFieldProps } from "./framework/types";
import type { SceneEditorContext } from "./schemas/sceneSchema";
import { interfaceDocumentFreezeScope } from "../ui-editor/uiLiveSession";

const TYPE_LABEL_KEYS: Record<UIPageParamType, TranslationKey> = {
    string: "properties.pageParams.typeString",
    text: "properties.pageParams.typeText",
    number: "properties.pageParams.typeNumber",
    boolean: "properties.pageParams.typeBoolean",
    list: "properties.pageParams.typeList",
    json: "properties.pageParams.typeJson",
};

/** The row-shape option that declares none. */
const ANY_ROW_SHAPE = "";

/** A value as the text field for its kind shows it. */
function formatPageParamValue(type: UIPageParamType, value: unknown): string {
    if (type === "json" || type === "list") {
        return value === undefined ? "" : JSON.stringify(value);
    }
    return value === undefined || value === null ? "" : String(value);
}

/**
 * What the text field for a kind gives back, or `undefined` when it gives nothing usable.
 *
 * A number that does not read as one and JSON that does not parse are not values, so the field puts
 * back what it held rather than storing them, and neither is JSON that is not a list for a list. An
 * empty field is the empty string for a string or a text - a value, as it is everywhere else in the
 * inspector - and nothing for the other kinds.
 */
function parsePageParamValue(type: UIPageParamType, text: string): { value: unknown } | null | undefined {
    const trimmed = text.trim();
    if (type === "string" || type === "text") {
        return { value: text };
    }
    if (!trimmed) {
        return null;
    }
    if (type === "number") {
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? { value: parsed } : undefined;
    }
    try {
        const value = JSON.parse(trimmed) as unknown;
        return type === "list" && !Array.isArray(value) ? undefined : { value };
    } catch {
        return undefined;
    }
}

/**
 * One value of a page parameter's kind: a text field, or a switch for a boolean.
 *
 * `value` undefined means nothing is stored, and the field shows `placeholder` instead - the declared
 * default, on a Page widget. `onCommit(null)` asks to store nothing: an emptied number or JSON field.
 */
export function PageParamValueInput({
    type,
    value,
    placeholder,
    ariaLabel,
    disabled,
    onCommit,
}: {
    type: UIPageParamType;
    value: unknown;
    placeholder?: unknown;
    ariaLabel: string;
    disabled?: boolean;
    onCommit: (next: unknown | null) => void;
}) {
    if (type === "boolean") {
        const checked = value === undefined ? placeholder === true : coerceUIPageParamValue("boolean", value) === true;
        return (
            <Switch
                size="sm"
                checked={checked}
                disabled={disabled}
                aria-label={ariaLabel}
                onCheckedChange={next => onCommit(next)}
            />
        );
    }
    return (
        <DraftInput
            value={formatPageParamValue(type, value)}
            placeholder={value === undefined && placeholder !== undefined ? formatPageParamValue(type, placeholder) : undefined}
            ariaLabel={ariaLabel}
            disabled={disabled}
            onCommit={text => {
                const parsed = parsePageParamValue(type, text);
                if (parsed === null) {
                    onCommit(null);
                } else if (parsed !== undefined) {
                    onCommit(parsed.value);
                }
            }}
        />
    );
}

/**
 * The Params section of a page's inspector.
 *
 * A new parameter is named after its id, so it can be read and opened with at once; renaming it moves
 * nothing that points at it. A name another parameter of the page already has is not taken - two
 * values under one key would be one value - and neither is an empty one: the field goes back to the
 * name it had.
 */
export function SurfacePageParamsField({ data }: CustomFieldProps<SceneEditorContext>) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard(interfaceDocumentFreezeScope());
    const surfaceId = data.surface.id;
    const live = data.documentService.getDocument().surfaces.find(surface => surface.id === surfaceId) ?? data.surface;
    const params = getUIPageParams(live);

    const write = (next: UIPageParam[]) => data.documentService.setPageParams(surfaceId, next);
    const patchParam = (id: string, patch: Partial<UIPageParam>) =>
        write(params.map(param => (param.id === id ? { ...param, ...patch } : param)));
    const rename = (id: string, name: string) => {
        const trimmed = name.trim();
        if (!trimmed || params.some(param => param.id !== id && param.name === trimmed)) {
            return;
        }
        patchParam(id, { name: trimmed });
    };
    const retype = (param: UIPageParam, type: UIPageParamType) => {
        // The default follows the kind - "3" becomes 3, anything a number cannot hold the empty value.
        // A list starts empty, and only a list has a row shape.
        const { defaultValue: _previous, struct: _struct, ...rest } = param;
        const carried =
            type === "list" || param.defaultValue === undefined
                ? undefined
                : coerceUIPageParamValue(type, param.defaultValue);
        patchParam(param.id, { ...rest, type, ...(carried === undefined ? {} : { defaultValue: carried }) });
    };
    const reshape = (param: UIPageParam, struct: string) => {
        const { struct: _previous, ...rest } = param;
        patchParam(param.id, struct ? { ...rest, struct } : rest);
    };

    const typeOptions = UI_PAGE_PARAM_TYPES.map(type => ({ value: type, label: t(TYPE_LABEL_KEYS[type]) }));
    // The shapes the engine and loaded plugins declare - the ones a node hands rows of out. A list's
    // own shape has no name to offer it by.
    const shapeOptions = [
        { value: ANY_ROW_SHAPE, label: t("properties.pageParams.anyShape") },
        ...listEngineUIStructIds()
            .map(id => ({ value: id, label: blueprintStructName(id, t) }))
            .sort((a, b) => a.label.localeCompare(b.label)),
    ];

    return (
        <div className="space-y-2">
            {params.length === 0 ? (
                <div className="rounded-md border border-dashed border-edge px-3 py-3 text-center text-xs text-fg-subtle">
                    {t("properties.pageParams.none")}
                </div>
            ) : (
                params.map(param => (
                    <div key={param.id} className="rounded-md border border-edge bg-surface px-2 py-2">
                        <div className="flex items-center gap-2">
                            <DraftInput
                                value={param.name}
                                placeholder={t("properties.pageParams.namePlaceholder")}
                                ariaLabel={t("properties.pageParams.namePlaceholder")}
                                {...freeze.writes()}
                                onCommit={next => rename(param.id, next)}
                            />
                            <Select
                                size="sm"
                                className="w-24 shrink-0"
                                value={param.type}
                                options={typeOptions}
                                portalMenu
                                ariaLabel={t("properties.pageParams.type")}
                                disabled={freeze.frozen}
                                onChange={value => retype(param, value as UIPageParamType)}
                            />
                            <button
                                type="button"
                                className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-edge-subtle hover:text-fg disabled:pointer-events-none disabled:opacity-50"
                                disabled={freeze.frozen}
                                onClick={() => write(params.filter(item => item.id !== param.id))}
                                aria-label={t("properties.pageParams.remove", { name: param.name })}
                                data-tip={t("properties.pageParams.remove", { name: param.name })}
                            >
                                <X className="h-3 w-3" aria-hidden />
                            </button>
                        </div>
                        {param.type === "list" ? (
                            <div className="mt-2 flex items-center gap-2 border-t border-edge-subtle pt-2">
                                <span className="w-20 shrink-0 text-2xs text-fg-muted">
                                    {t("properties.pageParams.rowShape")}
                                </span>
                                <div className="flex min-w-0 flex-1 items-center">
                                    <Select
                                        size="sm"
                                        className="w-full"
                                        value={param.struct ?? ANY_ROW_SHAPE}
                                        options={
                                            param.struct && !shapeOptions.some(option => option.value === param.struct)
                                                ? [...shapeOptions, { value: param.struct, label: blueprintStructName(param.struct, t) }]
                                                : shapeOptions
                                        }
                                        portalMenu
                                        ariaLabel={t("properties.pageParams.rowShape")}
                                        disabled={freeze.frozen}
                                        onChange={value => reshape(param, String(value))}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="mt-2 flex items-center gap-2 border-t border-edge-subtle pt-2">
                                <span className="w-20 shrink-0 text-2xs text-fg-muted">
                                    {t("properties.pageParams.default")}
                                </span>
                                <div className="flex min-w-0 flex-1 items-center">
                                    <PageParamValueInput
                                        type={param.type}
                                        value={uiPageParamDefaultValue(param)}
                                        ariaLabel={t("properties.pageParams.default")}
                                        disabled={freeze.frozen}
                                        onCommit={next => {
                                            const { defaultValue: _previous, ...rest } = param;
                                            patchParam(param.id, next === null ? rest : { ...rest, defaultValue: next });
                                        }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                ))
            )}
            <button
                type="button"
                className="flex min-h-7 w-full items-center justify-center gap-1 rounded-md border border-edge text-xs text-fg-muted hover:bg-fill hover:text-fg disabled:pointer-events-none disabled:opacity-50"
                disabled={freeze.frozen}
                onClick={() => {
                    const id = nextUIPageParamId(params);
                    // Named after the id, unless a parameter already took that name.
                    let name = id;
                    for (let index = 2; params.some(param => param.name === name); index++) {
                        name = `${id}_${index}`;
                    }
                    write([...params, { id, name, type: "string" }]);
                }}
            >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t("properties.pageParams.add")}
            </button>
            <p className="text-2xs text-fg-subtle">{t("properties.pageParams.hint")}</p>
        </div>
    );
}
