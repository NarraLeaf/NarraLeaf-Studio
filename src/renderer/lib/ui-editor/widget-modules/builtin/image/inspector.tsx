import { Radius, Scan } from "lucide-react";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { InlineRowItemContext } from "@/apps/workspace/modules/properties/framework/types";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import {
  getImageProps,
  IMAGE_WIDGET_FILL_MODES,
  imageFillToImageWidgetPropsPatch,
  imageWidgetPropsToImageFill,
} from "./helpers";
import type { ImageWidgetProps } from "./types";

export function createImageInspector(ctx: InspectorContext) {
  type D = UIInspectorData;
  const { element, documentService } = ctx;

  const patchProps = (patch: Partial<ImageWidgetProps>) => {
    documentService.updateElementProps(element.id, {
      ...element.props,
      ...patch,
    });
  };

  return createPropertyEditorSchema<D>({
    id: `ui-inspector:nl.image:${element.id}`,
    title: element.name ?? "Image",
    fields: [],
    tabs: [
      {
        id: "properties",
        title: "Properties",
        fields: [
          defineField<D, any>({
            id: "section.source",
            type: "section",
            title: "Source",
            fields: [
              defineField<D, any>({
                id: "image.sourceFill",
                type: "imageFill",
                label: "Source image",
                allowedFillModes: IMAGE_WIDGET_FILL_MODES,
                binding: {
                  propPath: "assetId",
                  readLiteral: (d: D) => getImageProps(d.element).assetId,
                },
                getValue: (d: D) => imageWidgetPropsToImageFill(getImageProps(d.element)),
                setValue: (_d: D, value: ImageFill) => {
                  const patch = imageFillToImageWidgetPropsPatch(value);
                  if (value.assetId?.trim()) {
                    patch.imageUrl = "";
                  }
                  patchProps(patch);
                },
              }),
              defineField<D, any>({
                id: "image.url",
                type: "text",
                label: "External URL (optional)",
                placeholder: "https://…",
                helpText: "Used when no project asset is selected above.",
                getValue: (d: D) => getImageProps(d.element).imageUrl,
                setValue: (_d: D, v: string) => patchProps({ imageUrl: v }),
              }),
            ],
          }),
          defineField<D, any>({
            id: "section.appearance",
            type: "section",
            title: "Appearance",
            fields: [
              defineField<D, any>({
                id: "image.appearanceRow",
                type: "inlineRow",
                gap: 8,
                wrap: true,
                label: undefined,
                items: [
                  {
                    id: "image.radius",
                    className: "flex-1 min-w-[100px]",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getImageProps(data.element);
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
                              patchProps({ borderRadius: Math.min(999, v) });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={0}
                          max={999}
                          unit="px"
                          leftIcon={<Radius className="w-4 h-4 text-gray-400" />}
                        />
                      );
                    },
                  },
                  {
                    id: "image.opacityPct",
                    className: "flex-1 min-w-[100px]",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getImageProps(data.element);
                      const percent = Math.round(current.imageOpacity * 100);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(percent)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            const clamped = Math.min(100, Math.max(0, v));
                            onSaving(true);
                            try {
                              patchProps({ imageOpacity: clamped / 100 });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          unit="%"
                          min={0}
                          max={100}
                          leftIcon={<Scan className="w-4 h-4 text-gray-400" />}
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
