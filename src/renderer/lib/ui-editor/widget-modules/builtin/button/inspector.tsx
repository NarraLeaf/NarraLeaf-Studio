import { Square } from "lucide-react";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { ColorValue, InlineRowItemContext } from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { getButtonProps } from "./helpers";
import type { ButtonWidgetProps } from "./types";

export function createButtonInspector(ctx: InspectorContext) {
  type D = UIInspectorData;
  const { element, documentService } = ctx;

  const patch = (partial: Partial<ButtonWidgetProps>) => {
    documentService.updateElementProps(element.id, {
      ...element.props,
      ...partial,
    });
  };

  return createPropertyEditorSchema<D>({
    id: `ui-inspector:nl.button:${element.id}`,
    title: element.name ?? "Button",
    fields: [],
    tabs: [
      {
        id: "properties",
        title: "Properties",
        fields: [
          defineField<D, any>({
            id: "section.appearance",
            type: "section",
            title: "Appearance",
            fields: [
              defineField<D, any>({
                id: "button.bgRow",
                type: "inlineRow",
                gap: 8,
                wrap: true,
                label: "Background",
                items: [
                  {
                    id: "button.bgPicker",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const raw = getButtonProps(data.element).backgroundColor;
                      const cv = parseColorValue(raw, { hex: "#374151", alpha: 1 });
                      const handleChange = (next: ColorValue) => {
                        onSaving(true);
                        try {
                          patch({ backgroundColor: colorValueToCss(next) });
                        } finally {
                          onSaving(false);
                        }
                      };
                      return (
                        <ColorPickerTrigger
                          value={cv}
                          displayMode="icon"
                          allowOpacity
                          onChange={handleChange}
                        />
                      );
                    },
                  },
                  {
                    id: "button.radius",
                    className: "flex-1 min-w-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getButtonProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.borderRadius)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            if (v < 0) {
                              return;
                            }
                            onSaving(true);
                            try {
                              patch({ borderRadius: Math.min(999, v) });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={0}
                          max={999}
                          unit="px"
                        />
                      );
                    },
                  },
                ],
              }),
            ],
          }),
          defineField<D, any>({
            id: "section.padding",
            type: "section",
            title: "Padding",
            fields: [
              defineField<D, any>({
                id: "button.paddingRow",
                type: "inlineRow",
                gap: 8,
                wrap: false,
                label: undefined,
                items: [
                  {
                    id: "button.padX",
                    className: "flex-1",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getButtonProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.paddingX)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            if (v < 0) {
                              return;
                            }
                            onSaving(true);
                            try {
                              patch({ paddingX: Math.min(128, v) });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={0}
                          max={128}
                          unit="px"
                          title="Horizontal padding"
                        />
                      );
                    },
                  },
                  {
                    id: "button.padY",
                    className: "flex-1",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getButtonProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.paddingY)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            if (v < 0) {
                              return;
                            }
                            onSaving(true);
                            try {
                              patch({ paddingY: Math.min(128, v) });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={0}
                          max={128}
                          unit="px"
                          title="Vertical padding"
                        />
                      );
                    },
                  },
                ],
              }),
            ],
          }),
          defineField<D, any>({
            id: "section.border",
            type: "section",
            title: "Border",
            fields: [
              defineField<D, any>({
                id: "button.borderStyle",
                type: "select",
                label: "Style",
                options: [
                  { value: "none", label: "None" },
                  { value: "solid", label: "Solid" },
                  { value: "dashed", label: "Dashed" },
                ],
                getValue: (d: D) => getButtonProps(d.element).borderStyle,
                setValue: (_d: D, v: string | number) =>
                  patch({ borderStyle: v as ButtonWidgetProps["borderStyle"] }),
              }),
              defineField<D, any>({
                id: "button.borderRow",
                type: "inlineRow",
                gap: 8,
                wrap: true,
                label: undefined,
                items: [
                  {
                    id: "button.borderWidth",
                    className: "flex-1 min-w-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getButtonProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.borderWidth)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            if (v < 0) {
                              return;
                            }
                            onSaving(true);
                            try {
                              patch({ borderWidth: Math.min(64, v) });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={0}
                          max={64}
                          unit="px"
                          leftIcon={<Square className="w-4 h-4 text-gray-400" />}
                        />
                      );
                    },
                  },
                  {
                    id: "button.borderColorPicker",
                    className: "flex-shrink-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const raw = getButtonProps(data.element).borderColor;
                      const cv = parseColorValue(raw, { hex: "#000000", alpha: 1 });
                      const handleChange = (next: ColorValue) => {
                        onSaving(true);
                        try {
                          patch({ borderColor: colorValueToCss(next) });
                        } finally {
                          onSaving(false);
                        }
                      };
                      return (
                        <ColorPickerTrigger
                          value={cv}
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
            id: "section.behavior",
            type: "section",
            title: "Behavior",
            fields: [
              defineField<D, any>({
                id: "button.clip",
                type: "checkbox",
                label: "Clip content",
                getValue: (d: D) => getButtonProps(d.element).clipContent,
                setValue: (_d: D, v: boolean) => patch({ clipContent: v }),
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
            title: "Blueprint",
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
