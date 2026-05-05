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
import { getSupportedEffectKindsForWidgetType } from "@shared/types/ui-editor/effects";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type {
  ColorValue,
  CustomFieldProps,
  IconButtonSelection,
  InlineRowItemContext,
} from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { StaticEffectsSection } from "@/lib/ui-editor/widget-modules/shared/effects/StaticEffectsSection";
import { getTextProps } from "./helpers";
import type { TextAlign, TextVerticalAlign, TextWidgetProps, TextWrapMode } from "./types";

function TextEffectsField(props: CustomFieldProps<UIInspectorData>) {
  const el = props.data.element;
  const live =
    props.data.documentService.getDocument().elements[el.id] ?? el;
  const flat = getTextProps(live);
  return (
    <StaticEffectsSection
      effects={flat.effects}
      onChange={next => {
        const docEl =
          props.data.documentService.getDocument().elements[el.id] ?? live;
        props.data.documentService.updateElementProps(el.id, {
          ...docEl.props,
          effects: next,
        });
      }}
      supportedKinds={getSupportedEffectKindsForWidgetType("nl.text")}
      draftResetKey={el.id}
    />
  );
}

export function createTextInspector(ctx: InspectorContext) {
  type D = UIInspectorData;
  const { element, documentService } = ctx;

  const patchProps = (patch: Partial<TextWidgetProps>) => {
    documentService.updateElementProps(element.id, {
      ...element.props,
      ...patch,
    });
  };

  return createPropertyEditorSchema<D>({
    id: `ui-inspector:nl.text:${element.id}`,
    title: element.name ?? "Text",
    fields: [],
    tabs: [
      {
        id: "properties",
        title: "Properties",
        fields: [
          defineField<D, any>({
            id: "section.content",
            type: "section",
            title: "Content",
            fields: [
              defineField<D, any>({
                id: "text.content",
                type: "textarea",
                label: "Text",
                rows: 4,
                binding: {
                  propPath: "text",
                  readLiteral: (d: D) => getTextProps(d.element).text,
                },
                getValue: (d: D) => getTextProps(d.element).text,
                setValue: (d: D, v: string) => {
                  patchProps({ text: v });
                },
              }),
            ],
          }),
          defineField<D, any>({
            id: "section.typography",
            type: "section",
            title: "Typography",
            fields: [
              defineField<D, any>({
                id: "text.fontAsset",
                type: "fontAsset",
                label: "Font",
                getValue: (d: D) => getTextProps(d.element).fontAssetId,
                setValue: (_d: D, value: string | null) => {
                  patchProps({ fontAssetId: value });
                },
              }),
              defineField<D, any>({
                id: "text.typographyRow",
                type: "inlineRow",
                gap: 8,
                wrap: true,
                label: undefined,
                items: [
                  {
                    id: "text.fontSize",
                    className: "flex-1 min-w-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getTextProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.fontSize)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            onSaving(true);
                            try {
                              patchProps({ fontSize: Math.min(256, Math.max(8, v)) });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={8}
                          max={256}
                          unit="px"
                          leftIcon={<Type className="w-4 h-4 text-gray-400" />}
                        />
                      );
                    },
                  },
                  {
                    id: "text.lineHeight",
                    className: "flex-1 min-w-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getTextProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.lineHeight)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            if (v <= 0) {
                              return;
                            }
                            onSaving(true);
                            try {
                              patchProps({ lineHeight: Math.min(4, Math.max(0.8, v)) });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="decimal"
                          type="number"
                          min={0.8}
                          max={4}
                          step={0.05}
                          leftIcon={<Baseline className="w-4 h-4 text-gray-400" />}
                          title="Line height (unitless)"
                        />
                      );
                    },
                  },
                ],
              }),
              defineField<D, any>({
                id: "text.weight",
                type: "select",
                label: "Weight",
                options: [
                  { value: "normal", label: "Regular" },
                  { value: "600", label: "Semibold" },
                  { value: "bold", label: "Bold" },
                ],
                getValue: (d: D) => getTextProps(d.element).fontWeight,
                setValue: (_d: D, v: string | number) => {
                  patchProps({
                    fontWeight: v as TextWidgetProps["fontWeight"],
                  });
                },
              }),
              defineField<D, any>({
                id: "text.wrapMode",
                type: "select",
                label: "Line wrap",
                options: [
                  { value: "word", label: "Words" },
                  { value: "character", label: "Characters" },
                  { value: "nowrap", label: "No wrap" },
                ],
                getValue: (d: D) => getTextProps(d.element).textWrapMode,
                setValue: (_d: D, v: string | number) => {
                  patchProps({ textWrapMode: String(v) as TextWrapMode });
                },
              }),
              defineField<D, any>({
                id: "text.align",
                type: "iconButtonGroup",
                mode: "single",
                label: "Alignment",
                showLabels: false,
                options: [
                  { id: "left", icon: <AlignLeft className="w-4 h-4" />, label: "Align left" },
                  { id: "center", icon: <AlignCenter className="w-4 h-4" />, label: "Align center" },
                  { id: "right", icon: <AlignRight className="w-4 h-4" />, label: "Align right" },
                ],
                getValue: (d: D) => getTextProps(d.element).textAlign,
                setValue: (_d: D, value: IconButtonSelection) => {
                  if (typeof value !== "string") return;
                  patchProps({ textAlign: value as TextAlign });
                },
              }),
              defineField<D, any>({
                id: "text.verticalAlign",
                type: "iconButtonGroup",
                mode: "single",
                label: "Vertical alignment",
                showLabels: false,
                options: [
                  { id: "start", icon: <AlignVerticalJustifyStart className="w-4 h-4" />, label: "Align top" },
                  { id: "center", icon: <AlignVerticalJustifyCenter className="w-4 h-4" />, label: "Align middle" },
                  { id: "end", icon: <AlignVerticalJustifyEnd className="w-4 h-4" />, label: "Align bottom" },
                ],
                getValue: (d: D) => getTextProps(d.element).textVerticalAlign,
                setValue: (_d: D, value: IconButtonSelection) => {
                  if (typeof value !== "string") return;
                  patchProps({ textVerticalAlign: value as TextVerticalAlign });
                },
              }),
            ],
          }),
          defineField<D, any>({
            id: "section.color",
            type: "section",
            title: "Color",
            fields: [
              defineField<D, any>({
                id: "text.colorRow",
                type: "inlineRow",
                gap: 8,
                wrap: false,
                label: undefined,
                items: [
                  {
                    id: "text.colorPicker",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getTextProps(data.element);
                      const handleChange = (next: ColorValue) => {
                        onSaving(true);
                        try {
                          patchProps({ color: next.hex });
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
          defineField<D, any>({
            id: "section.effects",
            type: "section",
            title: "Effects",
            collapsible: true,
            defaultCollapsed: true,
            fields: [
              defineField<D, any>({
                id: "text.effects.panel",
                type: "custom",
                component: TextEffectsField,
              }),
            ],
          }),
        ],
      },
      {
        id: "interaction",
        title: "Interaction",
        fields: [
          defineField<D, any>({
            id: "section.blueprint",
            type: "section",
            title: "Control blueprint",
            fields: [
              defineField<D, any>({
                id: "interaction.blueprint.readonly",
                type: "custom",
                component: ReadonlyBlueprintSection,
              }),
            ],
          }),
        ],
      },
    ],
  });
}
