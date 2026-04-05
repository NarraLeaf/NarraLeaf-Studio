import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { ColorValue, InlineRowItemContext } from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { getSpacerDividerProps } from "./helpers";
import type {
  SpacerDividerMode,
  SpacerDividerOrientation,
  SpacerDividerWidgetProps,
} from "./types";

export function createSpacerDividerInspector(ctx: InspectorContext) {
  type D = UIInspectorData;
  const { element, documentService } = ctx;

  const patch = (partial: Partial<SpacerDividerWidgetProps>) => {
    documentService.updateElementProps(element.id, {
      ...element.props,
      ...partial,
    });
  };

  return createPropertyEditorSchema<D>({
    id: `ui-inspector:nl.spacerDivider:${element.id}`,
    title: element.name ?? "Spacer / Divider",
    fields: [],
    tabs: [
      {
        id: "properties",
        title: "Properties",
        fields: [
          defineField<D, any>({
            id: "section.mode",
            type: "section",
            title: "Type",
            fields: [
              defineField<D, any>({
                id: "spacerDivider.mode",
                type: "select",
                label: "Mode",
                options: [
                  { value: "spacer", label: "Spacer (empty space)" },
                  { value: "divider", label: "Divider (line)" },
                ],
                getValue: (d: D) => getSpacerDividerProps(d.element).mode,
                setValue: (_d: D, v: string | number) => patch({ mode: v as SpacerDividerMode }),
              }),
              defineField<D, any>({
                id: "spacerDivider.orientation",
                type: "select",
                label: "Orientation",
                options: [
                  { value: "horizontal", label: "Horizontal" },
                  { value: "vertical", label: "Vertical" },
                ],
                getValue: (d: D) => getSpacerDividerProps(d.element).orientation,
                setValue: (_d: D, v: string | number) =>
                  patch({ orientation: v as SpacerDividerOrientation }),
              }),
              defineField<D, any>({
                id: "spacerDivider.thickness",
                type: "inlineRow",
                gap: 8,
                wrap: false,
                label: "Thickness",
                items: [
                  {
                    id: "spacerDivider.thicknessInput",
                    className: "flex-1",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getSpacerDividerProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.thickness)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            const clamped = Math.min(64, Math.max(1, v));
                            onSaving(true);
                            try {
                              patch({ thickness: clamped });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={1}
                          max={64}
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
            id: "section.dividerLook",
            type: "section",
            title: "Divider appearance",
            hidden: (data: D) => getSpacerDividerProps(data.element).mode !== "divider",
            fields: [
              defineField<D, any>({
                id: "spacerDivider.colorRow",
                type: "inlineRow",
                gap: 8,
                wrap: false,
                label: "Line color",
                items: [
                  {
                    id: "spacerDivider.colorPicker",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const raw = getSpacerDividerProps(data.element).color;
                      const cv = parseColorValue(raw, { hex: "#444444", alpha: 1 });
                      const handleChange = (next: ColorValue) => {
                        onSaving(true);
                        try {
                          patch({ color: colorValueToCss(next) });
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
            id: "section.insets",
            type: "section",
            title: "Insets (divider)",
            hidden: (data: D) => getSpacerDividerProps(data.element).mode !== "divider",
            fields: [
              defineField<D, any>({
                id: "spacerDivider.insetRow",
                type: "inlineRow",
                gap: 8,
                wrap: false,
                label: undefined,
                items: [
                  {
                    id: "spacerDivider.insetStart",
                    className: "flex-1",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getSpacerDividerProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.insetStart)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            if (v < 0) {
                              return;
                            }
                            onSaving(true);
                            try {
                              patch({ insetStart: Math.min(256, v) });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={0}
                          max={256}
                          unit="px"
                          title="Inset at start"
                        />
                      );
                    },
                  },
                  {
                    id: "spacerDivider.insetEnd",
                    className: "flex-1",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getSpacerDividerProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.insetEnd)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            if (v < 0) {
                              return;
                            }
                            onSaving(true);
                            try {
                              patch({ insetEnd: Math.min(256, v) });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={0}
                          max={256}
                          unit="px"
                          title="Inset at end"
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
