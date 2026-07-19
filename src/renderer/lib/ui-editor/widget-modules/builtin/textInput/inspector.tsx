import { useLayoutEffect } from "react";
import { AlignCenter, AlignLeft, AlignRight, Baseline, Type } from "lucide-react";
import type { UITextInputMode } from "@shared/types/ui-editor/textInput";
import type {
    ColorValue,
    CustomFieldProps,
    IconButtonSelection,
    InlineRowItemContext,
} from "@/apps/workspace/modules/properties/framework/types";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { AppearanceAuthoringPanel } from "@/lib/ui-editor/widget-modules/shared/appearance/AppearanceAuthoringPanel";
import {
    ensureButtonAppearanceHasAllKeys,
    isUsableAppearanceModel,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { createLocalizationKeyField } from "@/lib/ui-editor/widget-modules/shared/LocalizationKeyField";
import { createBlueprintValueField } from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintValueField";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import type { TextAlign } from "@/lib/ui-editor/widget-modules/builtin/text/types";
import { i18nStore, translate } from "@/lib/i18n";
import {
    getTextInputProps,
    patchTextInputProps,
    textInputButtonBaselineProps,
    type TextInputWidgetProps,
} from "./helpers";

const TEXT_FIELD_CLASS =
    "w-full rounded-md border border-edge bg-surface-sunken px-2 py-1.5 text-xs text-fg outline-none focus:border-primary/70 focus:ring-1 focus:ring-primary/40";

/** Always read through the live document: a schema closure can outlive the props it captured. */
function liveElement(data: UIInspectorData) {
    return data.documentService.getDocument().elements[data.element.id] ?? data.element;
}

function getLiveTextInputProps(data: UIInspectorData): TextInputWidgetProps {
    return getTextInputProps(liveElement(data));
}

function patchTextInput(data: UIInspectorData, partial: Partial<TextInputWidgetProps>): void {
    const live = liveElement(data);
    data.documentService.updateElementProps(live.id, patchTextInputProps(live, partial));
}

/** Module-level so FieldRenderer keeps a stable component identity across schema rebuilds. */
function TextInputAppearanceField(props: CustomFieldProps<UIInspectorData>) {
    const { documentService, element } = props.data;
    const appearance = getTextInputProps(element).appearance;

    useLayoutEffect(() => {
        if (!isUsableAppearanceModel(appearance)) {
            return;
        }
        const next = ensureButtonAppearanceHasAllKeys(
            appearance,
            textInputButtonBaselineProps(getTextInputProps(element)),
        );
        if (next !== appearance) {
            documentService.updateElementProps(element.id, { appearance: next });
        }
    }, [appearance, documentService, element]);

    return (
        <AppearanceAuthoringPanel
            key={element.id}
            kind="button"
            appearance={appearance ?? null}
            onReplace={next => {
                documentService.updateElementProps(element.id, { appearance: next });
            }}
            inspectorData={props.data}
            draftResetKey={element.id}
        />
    );
}

const TextInputValueBlueprintField = createBlueprintValueField({
    propPath: "value",
    valueType: "string",
    valueLabel: "value",
    title: "widgets.blueprintValue.textInputValueTitle",
    getDisplayName: ({ liveElement: live }) =>
        translate("widgets.blueprintValue.nameValue", {
            name: live.name ?? translate("widgets.defaults.textInput.name"),
        }),
    getLiteralValue: ({ liveElement: live }) => getTextInputProps(live).value,
    renderLiteralEditor: ({ data, liveElement: live }) => (
        <input
            type="text"
            className={TEXT_FIELD_CLASS}
            value={getTextInputProps(live).value}
            onChange={event => patchTextInput(data, { value: event.target.value })}
        />
    ),
});

const TextInputPlaceholderLocalizationKeyField = createLocalizationKeyField({
    getKey: element => getTextInputProps(element).placeholderLocalizationKey ?? "",
    setKey: (data, value) => patchTextInput(data, { placeholderLocalizationKey: value ?? null }),
});

export function createTextInputInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { t } = i18nStore.getTranslator();
    const { element } = ctx;

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.textInput:${element.id}`,
        title: element.name ?? t("widgets.textInput.title"),
        fields: [],
        tabs: [
            {
                id: "properties",
                title: t("widgets.tabs.properties"),
                fields: [
                    defineField<D, any>({
                        id: "section.textInputContent",
                        type: "section",
                        title: t("widgets.content"),
                        fields: [
                            defineField<D, any>({
                                id: "textInput.value",
                                type: "custom",
                                label: t("widgets.textInput.value"),
                                helpText: t("widgets.textInput.valueHint"),
                                component: TextInputValueBlueprintField,
                            }),
                            defineField<D, any>({
                                id: "textInput.placeholder",
                                type: "text",
                                label: t("widgets.textInput.placeholder"),
                                getValue: (d: D) => getLiveTextInputProps(d).placeholder,
                                setValue: (d: D, value: string) => patchTextInput(d, { placeholder: value }),
                            }),
                            defineField<D, any>({
                                id: "textInput.placeholderLocalizationKey",
                                type: "custom",
                                label: t("widgets.textInput.placeholderKey"),
                                helpText: t("widgets.textInput.placeholderKeyHint"),
                                component: TextInputPlaceholderLocalizationKeyField,
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.textInputBehavior",
                        type: "section",
                        title: t("widgets.textInput.sectionBehavior"),
                        fields: [
                            defineField<D, any>({
                                id: "textInput.inputMode",
                                type: "select",
                                label: t("widgets.textInput.inputMode"),
                                options: [
                                    { value: "text", label: t("widgets.textInput.inputModeText") },
                                    { value: "password", label: t("widgets.textInput.inputModePassword") },
                                    { value: "number", label: t("widgets.textInput.inputModeNumber") },
                                ],
                                getValue: (d: D) => getLiveTextInputProps(d).inputMode,
                                setValue: (d: D, value: string | number) =>
                                    patchTextInput(d, { inputMode: String(value) as UITextInputMode }),
                            }),
                            defineField<D, any>({
                                id: "textInput.maxLength",
                                type: "number",
                                label: t("widgets.textInput.maxLength"),
                                helpText: t("widgets.textInput.maxLengthHint"),
                                min: 0,
                                step: 1,
                                getValue: (d: D) => getLiveTextInputProps(d).maxLength,
                                setValue: (d: D, value: number) =>
                                    patchTextInput(d, { maxLength: Math.max(0, Math.floor(value)) }),
                            }),
                            defineField<D, any>({
                                id: "textInput.readOnly",
                                type: "checkbox",
                                label: t("widgets.textInput.readOnly"),
                                getValue: (d: D) => getLiveTextInputProps(d).readOnly,
                                setValue: (d: D, value: boolean) => patchTextInput(d, { readOnly: value }),
                            }),
                            defineField<D, any>({
                                id: "textInput.disabled",
                                type: "checkbox",
                                label: t("widgets.textInput.disabled"),
                                getValue: (d: D) => getLiveTextInputProps(d).disabled,
                                setValue: (d: D, value: boolean) => patchTextInput(d, { disabled: value }),
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.textInputTypography",
                        type: "section",
                        title: t("widgets.typography.title"),
                        fields: [
                            defineField<D, any>({
                                id: "textInput.fontAsset",
                                type: "fontAsset",
                                label: t("widgets.typography.font"),
                                getValue: (d: D) => getLiveTextInputProps(d).fontAssetId,
                                setValue: (d: D, value: string | null) => patchTextInput(d, { fontAssetId: value }),
                            }),
                            defineField<D, any>({
                                id: "textInput.typographyRow",
                                type: "inlineRow",
                                gap: 8,
                                wrap: true,
                                label: undefined,
                                items: [
                                    {
                                        id: "textInput.fontSize",
                                        className: "flex-1 min-w-0",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => (
                                            <NumericDraftEnhancedInput
                                                committedDisplay={String(getLiveTextInputProps(data).fontSize)}
                                                draftResetKey={element.id}
                                                onFiniteNumber={v => {
                                                    onSaving(true);
                                                    try {
                                                        patchTextInput(data, {
                                                            fontSize: Math.min(256, Math.max(8, v)),
                                                        });
                                                    } finally {
                                                        onSaving(false);
                                                    }
                                                }}
                                                inputMode="numeric"
                                                type="number"
                                                min={8}
                                                max={256}
                                                unit="px"
                                                leftIcon={<Type className="w-4 h-4 text-fg-muted" />}
                                            />
                                        ),
                                    },
                                    {
                                        id: "textInput.lineHeight",
                                        className: "flex-1 min-w-0",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => (
                                            <NumericDraftEnhancedInput
                                                committedDisplay={String(getLiveTextInputProps(data).lineHeight)}
                                                draftResetKey={element.id}
                                                onFiniteNumber={v => {
                                                    if (v <= 0) {
                                                        return;
                                                    }
                                                    onSaving(true);
                                                    try {
                                                        patchTextInput(data, {
                                                            lineHeight: Math.min(4, Math.max(0.8, v)),
                                                        });
                                                    } finally {
                                                        onSaving(false);
                                                    }
                                                }}
                                                inputMode="decimal"
                                                type="number"
                                                min={0.8}
                                                max={4}
                                                step={0.05}
                                                leftIcon={<Baseline className="w-4 h-4 text-fg-muted" />}
                                                title={t("widgets.typography.lineHeightHint")}
                                            />
                                        ),
                                    },
                                ],
                            }),
                            defineField<D, any>({
                                id: "textInput.weight",
                                type: "select",
                                label: t("widgets.typography.weight"),
                                options: [
                                    { value: "normal", label: t("widgets.typography.regular") },
                                    { value: "600", label: t("widgets.typography.semibold") },
                                    { value: "bold", label: t("widgets.typography.bold") },
                                ],
                                getValue: (d: D) => getLiveTextInputProps(d).fontWeight,
                                setValue: (d: D, v: string | number) =>
                                    patchTextInput(d, { fontWeight: v as TextInputWidgetProps["fontWeight"] }),
                            }),
                            defineField<D, any>({
                                id: "textInput.align",
                                type: "iconButtonGroup",
                                mode: "single",
                                label: t("widgets.typography.alignment"),
                                showLabels: false,
                                options: [
                                    {
                                        id: "left",
                                        icon: <AlignLeft className="w-4 h-4" />,
                                        label: t("widgets.typography.alignLeft"),
                                    },
                                    {
                                        id: "center",
                                        icon: <AlignCenter className="w-4 h-4" />,
                                        label: t("widgets.typography.alignCenter"),
                                    },
                                    {
                                        id: "right",
                                        icon: <AlignRight className="w-4 h-4" />,
                                        label: t("widgets.typography.alignRight"),
                                    },
                                ],
                                getValue: (d: D) => getLiveTextInputProps(d).textAlign,
                                setValue: (d: D, value: IconButtonSelection) => {
                                    if (typeof value !== "string") {
                                        return;
                                    }
                                    patchTextInput(d, { textAlign: value as TextAlign });
                                },
                            }),
                            defineField<D, any>({
                                id: "textInput.colorRow",
                                type: "inlineRow",
                                gap: 8,
                                wrap: false,
                                label: t("widgets.textInput.color"),
                                items: [
                                    {
                                        id: "textInput.colorPicker",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => (
                                            <ColorPickerTrigger
                                                value={{ hex: getLiveTextInputProps(data).color, alpha: 1 }}
                                                displayMode="icon"
                                                allowOpacity={false}
                                                onChange={(next: ColorValue) => {
                                                    onSaving(true);
                                                    try {
                                                        patchTextInput(data, { color: next.hex });
                                                    } finally {
                                                        onSaving(false);
                                                    }
                                                }}
                                            />
                                        ),
                                    },
                                ],
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.appearanceAuthoring",
                        type: "section",
                        title: t("widgets.appearance.title"),
                        collapsible: true,
                        defaultCollapsed: true,
                        helpText: t("widgets.appearance.modulesHelp"),
                        fields: [
                            defineField<D, any>({
                                id: "textInput.appearance.panel",
                                type: "custom",
                                component: TextInputAppearanceField,
                            }),
                        ],
                    }),
                ],
            },
            {
                id: "interaction",
                title: t("widgets.tabs.interaction"),
                fields: [
                    defineField<D, any>({
                        id: "interaction.blueprint.readonly",
                        type: "custom",
                        label: t("widgets.blueprint.controlLabel"),
                        component: ReadonlyBlueprintSection,
                    }),
                ],
            },
        ],
    });
}
