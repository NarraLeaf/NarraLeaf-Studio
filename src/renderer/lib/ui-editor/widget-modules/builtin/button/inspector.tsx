import { useLayoutEffect } from "react";
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    AlignVerticalJustifyCenter,
    AlignVerticalJustifyEnd,
    AlignVerticalJustifyStart,
    Baseline,
    Type,
} from "lucide-react";
import type {
    ColorValue,
    CustomFieldProps,
    IconButtonSelection,
    InlineRowItemContext,
} from "@/apps/workspace/modules/properties/framework/types";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import { listLocalizationKeyOptions } from "@/lib/ui-editor/widget-modules/shared/localizationKeyOptions";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { AppearanceAuthoringPanel } from "@/lib/ui-editor/widget-modules/shared/appearance/AppearanceAuthoringPanel";
import { createBlueprintValueField } from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintValueField";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import {
    ensureButtonAppearanceHasAllKeys,
    isUsableAppearanceModel,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import type { TextAlign, TextVerticalAlign, TextWrapMode } from "@/lib/ui-editor/widget-modules/builtin/text/types";
import { i18nStore } from "@/lib/i18n";
import { getButtonProps } from "./helpers";
import type { ButtonWidgetProps } from "./types";

/** Module-level so FieldRenderer keeps a stable component identity across schema rebuilds (preserves variant selection). */
function ButtonAppearanceField(props: CustomFieldProps<UIInspectorData>) {
    const flat = getButtonProps(props.data.element);
    const appearance = flat.appearance;
    const { documentService } = props.data;
    const element = props.data.element;

    useLayoutEffect(() => {
        if (!isUsableAppearanceModel(appearance)) {
            return;
        }
        const f = getButtonProps(element);
        const next = ensureButtonAppearanceHasAllKeys(appearance, f);
        if (next !== appearance) {
            documentService.updateElementProps(element.id, {
                appearance: next,
            });
        }
    }, [appearance, documentService, element]);

    return (
        <AppearanceAuthoringPanel
            key={element.id}
            kind="button"
            appearance={appearance ?? null}
            onReplace={next => {
                documentService.updateElementProps(element.id, {
                    appearance: next,
                });
            }}
            inspectorData={props.data}
            draftResetKey={element.id}
        />
    );
}

const ButtonLabelBlueprintValueField = createBlueprintValueField({
    propPath: "label",
    valueType: "string",
    valueLabel: "label",
    title: "Button Text Value",
    getDisplayName: ({ liveElement }) => `${liveElement.name ?? "Button"} label`,
    getLiteralValue: ({ liveElement }) => getButtonProps(liveElement).label,
    renderLiteralEditor: ({ data, liveElement }) => {
        const buttonProps = getButtonProps(liveElement);
        return (
            <textarea
                className="min-h-[88px] w-full resize-y rounded-md border border-edge bg-[#0b0d10] px-2 py-1.5 text-xs text-fg outline-none focus:border-cyan-400/70 focus:ring-1 focus:ring-cyan-400/40"
                value={buttonProps.label}
                rows={4}
                onChange={event => {
                    data.documentService.updateElementProps(liveElement.id, {
                        ...liveElement.props,
                        label: event.target.value,
                    });
                }}
            />
        );
    },
});

export function createButtonInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { t } = i18nStore.getTranslator();
    const { element, documentService } = ctx;

    const patch = (partial: Partial<ButtonWidgetProps>) => {
        documentService.updateElementProps(element.id, {
            ...element.props,
            ...partial,
        });
    };

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.button:${element.id}`,
        title: element.name ?? t("widgets.button.title"),
        fields: [],
        tabs: [
            {
                id: "properties",
                title: t("widgets.tabs.properties"),
                fields: [
                    defineField<D, any>({
                        id: "section.buttonText",
                        type: "section",
                        title: t("widgets.button.sectionText"),
                        fields: [
                            defineField<D, any>({
                                id: "section.buttonContent",
                                type: "section",
                                title: t("widgets.content"),
                                fields: [
                                    defineField<D, any>({
                                        id: "button.label",
                                        type: "custom",
                                        label: t("widgets.textLabel"),
                                        component: ButtonLabelBlueprintValueField,
                                    }),
                                ],
                            }),
                            defineField<D, any>({
                                id: "section.buttonTypography",
                                type: "section",
                                title: t("widgets.typography.title"),
                                fields: [
                                    defineField<D, any>({
                                        id: "button.fontAsset",
                                        type: "fontAsset",
                                        label: t("widgets.typography.font"),
                                        getValue: (d: D) => getButtonProps(d.element).fontAssetId,
                                        setValue: (_d: D, value: string | null) => {
                                            patch({ fontAssetId: value });
                                        },
                                    }),
                                    defineField<D, any>({
                                        id: "button.typographyRow",
                                        type: "inlineRow",
                                        gap: 8,
                                        wrap: true,
                                        label: undefined,
                                        items: [
                                            {
                                                id: "button.fontSize",
                                                className: "flex-1 min-w-0",
                                                render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                                    const current = getButtonProps(data.element);
                                                    return (
                                                        <NumericDraftEnhancedInput
                                                            committedDisplay={String(current.fontSize)}
                                                            draftResetKey={element.id}
                                                            onFiniteNumber={v => {
                                                                onSaving(true);
                                                                try {
                                                                    patch({
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
                                                    );
                                                },
                                            },
                                            {
                                                id: "button.lineHeight",
                                                className: "flex-1 min-w-0",
                                                render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                                    const current = getButtonProps(data.element);
                                                    return (
                                                        <NumericDraftEnhancedInput
                                                            committedDisplay={String(current.lineHeight)}
                                                            draftResetKey={element.id}
                                                            onFiniteNumber={v => {
                                                                if (v <= 0) {
                                                                    return;
                                                                }
                                                                onSaving(true);
                                                                try {
                                                                    patch({
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
                                                    );
                                                },
                                            },
                                        ],
                                    }),
                                    defineField<D, any>({
                                        id: "button.weight",
                                        type: "select",
                                        label: t("widgets.typography.weight"),
                                        options: [
                                            { value: "normal", label: t("widgets.typography.regular") },
                                            { value: "600", label: t("widgets.typography.semibold") },
                                            { value: "bold", label: t("widgets.typography.bold") },
                                        ],
                                        getValue: (d: D) => getButtonProps(d.element).fontWeight,
                                        setValue: (_d: D, v: string | number) => {
                                            patch({
                                                fontWeight: v as ButtonWidgetProps["fontWeight"],
                                            });
                                        },
                                    }),
                                    defineField<D, any>({
                                        id: "button.wrapMode",
                                        type: "select",
                                        label: t("widgets.typography.lineWrap"),
                                        options: [
                                            { value: "word", label: t("widgets.typography.wrapWords") },
                                            { value: "character", label: t("widgets.typography.wrapCharacters") },
                                            { value: "nowrap", label: t("widgets.typography.wrapNone") },
                                        ],
                                        getValue: (d: D) => getButtonProps(d.element).textWrapMode,
                                        setValue: (_d: D, v: string | number) => {
                                            patch({ textWrapMode: String(v) as TextWrapMode });
                                        },
                                    }),
                                    defineField<D, any>({
                                        id: "button.align",
                                        type: "iconButtonGroup",
                                        mode: "single",
                                        label: t("widgets.typography.alignment"),
                                        showLabels: false,
                                        options: [
                                            { id: "left", icon: <AlignLeft className="w-4 h-4" />, label: t("widgets.typography.alignLeft") },
                                            {
                                                id: "center",
                                                icon: <AlignCenter className="w-4 h-4" />,
                                                label: t("widgets.typography.alignCenter"),
                                            },
                                            { id: "right", icon: <AlignRight className="w-4 h-4" />, label: t("widgets.typography.alignRight") },
                                        ],
                                        getValue: (d: D) => getButtonProps(d.element).textAlign,
                                        setValue: (_d: D, value: IconButtonSelection) => {
                                            if (typeof value !== "string") return;
                                            patch({ textAlign: value as TextAlign });
                                        },
                                    }),
                                    defineField<D, any>({
                                        id: "button.verticalAlign",
                                        type: "iconButtonGroup",
                                        mode: "single",
                                        label: t("widgets.typography.verticalAlignment"),
                                        showLabels: false,
                                        options: [
                                            {
                                                id: "start",
                                                icon: <AlignVerticalJustifyStart className="w-4 h-4" />,
                                                label: t("widgets.typography.alignTop"),
                                            },
                                            {
                                                id: "center",
                                                icon: <AlignVerticalJustifyCenter className="w-4 h-4" />,
                                                label: t("widgets.typography.alignMiddle"),
                                            },
                                            {
                                                id: "end",
                                                icon: <AlignVerticalJustifyEnd className="w-4 h-4" />,
                                                label: t("widgets.typography.alignBottom"),
                                            },
                                        ],
                                        getValue: (d: D) => getButtonProps(d.element).textVerticalAlign,
                                        setValue: (_d: D, value: IconButtonSelection) => {
                                            if (typeof value !== "string") return;
                                            patch({ textVerticalAlign: value as TextVerticalAlign });
                                        },
                                    }),
                                ],
                            }),
                            defineField<D, any>({
                                id: "section.buttonColor",
                                type: "section",
                                title: t("widgets.button.sectionColor"),
                                fields: [
                                    defineField<D, any>({
                                        id: "button.colorRow",
                                        type: "inlineRow",
                                        gap: 8,
                                        wrap: false,
                                        label: undefined,
                                        items: [
                                            {
                                                id: "button.colorPicker",
                                                render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                                    const current = getButtonProps(data.element);
                                                    const handleChange = (next: ColorValue) => {
                                                        onSaving(true);
                                                        try {
                                                            patch({ color: next.hex });
                                                        } finally {
                                                            onSaving(false);
                                                        }
                                                    };
                                                    return (
                                                        <ColorPickerTrigger
                                                            value={{ hex: current.color, alpha: 1 }}
                                                            displayMode="icon"
                                                            allowOpacity={false}
                                                            onChange={handleChange}
                                                        />
                                                    );
                                                },
                                            },
                                        ],
                                    }),
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
                                id: "button.appearance.panel",
                                type: "custom",
                                component: ButtonAppearanceField,
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.behavior",
                        type: "section",
                        title: t("widgets.button.sectionBehavior"),
                        collapsible: true,
                        defaultCollapsed: true,
                        fields: [
                            defineField<D, any>({
                                id: "button.interactionDisabled",
                                type: "checkbox",
                                label: t("widgets.button.interactionDisabled"),
                                getValue: (d: D) => Boolean(getButtonProps(d.element).interactionDisabled),
                                setValue: (_d: D, v: boolean) => patch({ interactionDisabled: v }),
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.localization",
                        type: "section",
                        title: t("widgets.localization.title"),
                        collapsible: true,
                        defaultCollapsed: true,
                        fields: [
                            defineField<D, any>({
                                id: "button.localizable",
                                type: "checkbox",
                                label: t("widgets.button.localizeLabel"),
                                getValue: (d: D) => Boolean(getButtonProps(d.element).localizable),
                                setValue: (_d: D, v: boolean) => patch({ localizable: v }),
                            }),
                            defineField<D, any>({
                                id: "button.localizationKey",
                                type: "select",
                                label: t("widgets.localization.textKey"),
                                options: () => listLocalizationKeyOptions(),
                                getValue: (d: D) => getButtonProps(d.element).localizationKey ?? "",
                                setValue: (_d: D, v: string | number) => patch({ localizationKey: String(v).trim() || undefined }),
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
