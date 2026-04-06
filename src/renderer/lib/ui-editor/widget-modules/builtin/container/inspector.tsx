import { Square } from "lucide-react";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { ColorValue, InlineRowItemContext } from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { getContainerProps } from "./helpers";
import type { ContainerWidgetProps } from "./types";

export function createContainerInspector(ctx: InspectorContext) {
  type D = UIInspectorData;
  const { element, documentService } = ctx;

  const patch = (partial: Partial<ContainerWidgetProps>) => {
    documentService.updateElementProps(element.id, {
      ...element.props,
      ...partial,
    });
  };

  return createPropertyEditorSchema<D>({
    id: `ui-inspector:nl.container:${element.id}`,
    title: element.name ?? "Container",
    fields: [],
    tabs: [
      {
        id: "properties",
        title: "Properties",
        fields: [
          defineField<D, any>({
            id: "section.fill",
            type: "section",
            title: "Fill",
            fields: [
              defineField<D, any>({
                id: "container.fillRow",
                type: "inlineRow",
                gap: 8,
                wrap: false,
                label: undefined,
                items: [
                  {
                    id: "container.bgPicker",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const raw = getContainerProps(data.element).backgroundColor;
                      const cv = parseColorValue(raw, { hex: "#FFFFFF", alpha: 0 });
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
                id: "container.borderStyle",
                type: "select",
                label: "Style",
                options: [
                  { value: "none", label: "None" },
                  { value: "solid", label: "Solid" },
                  { value: "dashed", label: "Dashed" },
                ],
                getValue: (d: D) => getContainerProps(d.element).borderStyle,
                setValue: (_d: D, v: string | number) =>
                  patch({ borderStyle: v as ContainerWidgetProps["borderStyle"] }),
              }),
              defineField<D, any>({
                id: "container.borderRow",
                type: "inlineRow",
                gap: 8,
                wrap: true,
                label: undefined,
                items: [
                  {
                    id: "container.borderWidth",
                    className: "flex-1 min-w-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getContainerProps(data.element);
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
                    id: "container.borderRadius",
                    className: "flex-1 min-w-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getContainerProps(data.element);
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
              defineField<D, any>({
                id: "container.borderColorRow",
                type: "inlineRow",
                gap: 8,
                wrap: false,
                label: "Color",
                items: [
                  {
                    id: "container.borderColorPicker",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const raw = getContainerProps(data.element).borderColor;
                      const cv = parseColorValue(raw, { hex: "#FFFFFF", alpha: 0.2 });
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
                          allowOpacity
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
                id: "container.clip",
                type: "checkbox",
                label: "Clip content",
                getValue: (d: D) => getContainerProps(d.element).clipContent,
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
