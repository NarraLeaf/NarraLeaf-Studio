import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceAround,
  AlignVerticalSpaceBetween,
  Columns2,
  Rows2,
  StretchHorizontal,
} from "lucide-react";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type {
  IconButtonSelection,
  InlineRowItemContext,
} from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { getStackProps } from "./helpers";
import type {
  StackAlignItems,
  StackDirection,
  StackJustifyContent,
  StackWidgetProps,
} from "./types";

export function createStackInspector(ctx: InspectorContext) {
  type D = UIInspectorData;
  const { element, documentService } = ctx;

  const patch = (partial: Partial<StackWidgetProps>) => {
    documentService.updateElementProps(element.id, {
      ...element.props,
      ...partial,
    });
  };

  return createPropertyEditorSchema<D>({
    id: `ui-inspector:nl.stack:${element.id}`,
    title: element.name ?? "Stack",
    fields: [],
    tabs: [
      {
        id: "properties",
        title: "Properties",
        fields: [
          defineField<D, any>({
            id: "section.layout",
            type: "section",
            title: "Layout",
            fields: [
              defineField<D, any>({
                id: "stack.direction",
                type: "iconButtonGroup",
                mode: "single",
                label: "Direction",
                showLabels: false,
                options: [
                  { id: "vertical", icon: <Rows2 className="w-4 h-4" />, label: "Vertical stack" },
                  { id: "horizontal", icon: <Columns2 className="w-4 h-4" />, label: "Horizontal stack" },
                ],
                getValue: (d: D) => getStackProps(d.element).direction,
                setValue: (_d: D, value: IconButtonSelection) => {
                  if (typeof value !== "string") return;
                  patch({ direction: value as StackDirection });
                },
              }),
              defineField<D, any>({
                id: "stack.alignItems",
                type: "iconButtonGroup",
                mode: "single",
                label: "Align (cross axis)",
                showLabels: false,
                options: [
                  {
                    id: "start",
                    icon: <AlignHorizontalJustifyStart className="w-4 h-4" />,
                    label: "Start",
                  },
                  {
                    id: "center",
                    icon: <AlignHorizontalJustifyCenter className="w-4 h-4" />,
                    label: "Center",
                  },
                  {
                    id: "end",
                    icon: <AlignHorizontalJustifyEnd className="w-4 h-4" />,
                    label: "End",
                  },
                  {
                    id: "stretch",
                    icon: <StretchHorizontal className="w-4 h-4" />,
                    label: "Stretch",
                  },
                ],
                getValue: (d: D) => getStackProps(d.element).alignItems,
                setValue: (_d: D, value: IconButtonSelection) => {
                  if (typeof value !== "string") return;
                  patch({ alignItems: value as StackAlignItems });
                },
              }),
              defineField<D, any>({
                id: "stack.justifyContent",
                type: "iconButtonGroup",
                mode: "single",
                label: "Justify (main axis)",
                showLabels: false,
                options: [
                  {
                    id: "start",
                    icon: <AlignVerticalJustifyStart className="w-4 h-4" />,
                    label: "Start",
                  },
                  {
                    id: "center",
                    icon: <AlignVerticalJustifyCenter className="w-4 h-4" />,
                    label: "Center",
                  },
                  {
                    id: "end",
                    icon: <AlignVerticalJustifyEnd className="w-4 h-4" />,
                    label: "End",
                  },
                  {
                    id: "space-between",
                    icon: <AlignVerticalSpaceBetween className="w-4 h-4" />,
                    label: "Space between",
                  },
                  {
                    id: "space-around",
                    icon: <AlignVerticalSpaceAround className="w-4 h-4" />,
                    label: "Space around",
                  },
                ],
                getValue: (d: D) => getStackProps(d.element).justifyContent,
                setValue: (_d: D, value: IconButtonSelection) => {
                  if (typeof value !== "string") return;
                  patch({ justifyContent: value as StackJustifyContent });
                },
              }),
            ],
          }),
          defineField<D, any>({
            id: "section.spacing",
            type: "section",
            title: "Spacing",
            fields: [
              defineField<D, any>({
                id: "stack.spacingRow",
                type: "inlineRow",
                gap: 8,
                wrap: true,
                label: undefined,
                items: [
                  {
                    id: "stack.gap",
                    className: "flex-1 min-w-[100px]",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getStackProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.gap)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            if (v < 0) {
                              return;
                            }
                            onSaving(true);
                            try {
                              patch({ gap: Math.min(256, v) });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={0}
                          max={256}
                          unit="px"
                          title="Gap between children"
                        />
                      );
                    },
                  },
                  {
                    id: "stack.padding",
                    className: "flex-1 min-w-[100px]",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getStackProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.paddingTop)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            if (v < 0) {
                              return;
                            }
                            const clamped = Math.min(256, v);
                            onSaving(true);
                            try {
                              patch({
                                paddingTop: clamped,
                                paddingRight: clamped,
                                paddingBottom: clamped,
                                paddingLeft: clamped,
                              });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={0}
                          max={256}
                          unit="px"
                          title="Padding (all sides)"
                        />
                      );
                    },
                  },
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });
}
