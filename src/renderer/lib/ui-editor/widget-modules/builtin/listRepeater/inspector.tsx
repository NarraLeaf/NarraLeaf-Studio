import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { InlineRowItemContext } from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { getListRepeaterProps } from "./helpers";
import type { ListRepeaterDirection, ListRepeaterWidgetProps } from "./types";

export function createListRepeaterInspector(ctx: InspectorContext) {
  type D = UIInspectorData;
  const { element, documentService } = ctx;

  const patch = (partial: Partial<ListRepeaterWidgetProps>) => {
    documentService.updateElementProps(element.id, {
      ...element.props,
      ...partial,
    });
  };

  return createPropertyEditorSchema<D>({
    id: `ui-inspector:nl.listRepeater:${element.id}`,
    title: element.name ?? "List / Repeater",
    fields: [],
    tabs: [
      {
        id: "properties",
        title: "Properties",
        fields: [
          defineField<D, any>({
            id: "section.preview",
            type: "section",
            title: "Preview",
            fields: [
              defineField<D, any>({
                id: "listRepeater.previewCount",
                type: "inlineRow",
                gap: 8,
                wrap: false,
                label: "Rows / columns in editor",
                items: [
                  {
                    id: "listRepeater.previewCountInput",
                    className: "flex-1 max-w-[120px]",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getListRepeaterProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.previewCount)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            const clamped = Math.min(32, Math.max(1, Math.round(v)));
                            onSaving(true);
                            try {
                              patch({ previewCount: clamped });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={1}
                          max={32}
                        />
                      );
                    },
                  },
                ],
              }),
            ],
          }),
          defineField<D, any>({
            id: "section.list",
            type: "section",
            title: "List layout",
            fields: [
              defineField<D, any>({
                id: "listRepeater.repeatDirection",
                type: "select",
                label: "Repeat direction",
                options: [
                  { value: "vertical", label: "Vertical (stack items)" },
                  { value: "horizontal", label: "Horizontal (row of items)" },
                ],
                getValue: (d: D) => getListRepeaterProps(d.element).repeatDirection,
                setValue: (_d: D, v: string | number) =>
                  patch({ repeatDirection: v as ListRepeaterDirection }),
              }),
              defineField<D, any>({
                id: "listRepeater.itemGap",
                type: "inlineRow",
                gap: 8,
                wrap: false,
                label: "Space between items",
                items: [
                  {
                    id: "listRepeater.itemGapInput",
                    className: "flex-1 max-w-[120px]",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getListRepeaterProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.itemGap)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            if (v < 0) {
                              return;
                            }
                            onSaving(true);
                            try {
                              patch({ itemGap: Math.min(128, v) });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={0}
                          max={128}
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
            id: "section.template",
            type: "section",
            title: "Item template (inside each cell)",
            fields: [
              defineField<D, any>({
                id: "listRepeater.templateDirection",
                type: "select",
                label: "Content direction",
                options: [
                  { value: "vertical", label: "Vertical" },
                  { value: "horizontal", label: "Horizontal" },
                ],
                getValue: (d: D) => getListRepeaterProps(d.element).templateDirection,
                setValue: (_d: D, v: string | number) =>
                  patch({ templateDirection: v as ListRepeaterDirection }),
              }),
              defineField<D, any>({
                id: "listRepeater.templateGap",
                type: "inlineRow",
                gap: 8,
                wrap: false,
                label: "Space inside template",
                items: [
                  {
                    id: "listRepeater.templateGapInput",
                    className: "flex-1 max-w-[120px]",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getListRepeaterProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.templateGap)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            if (v < 0) {
                              return;
                            }
                            onSaving(true);
                            try {
                              patch({ templateGap: Math.min(128, v) });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={0}
                          max={128}
                          unit="px"
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
