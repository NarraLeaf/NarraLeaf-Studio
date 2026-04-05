import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { getImageProps } from "./helpers";
import type { ImageObjectFit } from "./types";

export function createImageInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { element, documentService } = ctx;

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
                        id: "image.assetId",
                        type: "text",
                        label: "Asset ID",
                        placeholder: "Project asset id",
                        binding: {
                            propPath: "assetId",
                            readLiteral: (d: D) => getImageProps(d.element).assetId,
                        },
                        getValue: (d: D) => getImageProps(d.element).assetId,
                        setValue: (d: D, v: string) => {
                            documentService.updateElementProps(d.element.id, {
                                ...d.element.props,
                                assetId: v,
                            });
                        },
                    }),
                    defineField<D, any>({
                        id: "image.url",
                        type: "text",
                        label: "Image URL (legacy)",
                        placeholder: "https://…",
                        getValue: (d: D) => getImageProps(d.element).imageUrl,
                        setValue: (d: D, v: string) => {
                            documentService.updateElementProps(d.element.id, {
                                ...d.element.props,
                                imageUrl: v,
                            });
                        },
                    }),
                    defineField<D, any>({
                        id: "image.fit",
                        type: "select",
                        label: "Object fit",
                        options: [
                            { value: "cover", label: "Cover" },
                            { value: "contain", label: "Contain" },
                            { value: "fill", label: "Fill" },
                        ],
                        getValue: (d: D) => getImageProps(d.element).objectFit,
                        setValue: (d: D, v: string | number) => {
                            documentService.updateElementProps(d.element.id, {
                                ...d.element.props,
                                objectFit: v as ImageObjectFit,
                            });
                        },
                    }),
                    defineField<D, any>({
                        id: "image.radius",
                        type: "number",
                        label: "Corner radius",
                        min: 0,
                        max: 999,
                        step: 1,
                        getValue: (d: D) => getImageProps(d.element).borderRadius,
                        setValue: (d: D, v: number) => {
                            documentService.updateElementProps(d.element.id, {
                                ...d.element.props,
                                borderRadius: v,
                            });
                        },
                    }),
                    defineField<D, any>({
                        id: "image.opacity",
                        type: "number",
                        label: "Image opacity",
                        min: 0,
                        max: 1,
                        step: 0.05,
                        getValue: (d: D) => getImageProps(d.element).imageOpacity,
                        setValue: (d: D, v: number) => {
                            documentService.updateElementProps(d.element.id, {
                                ...d.element.props,
                                imageOpacity: Math.max(0, Math.min(1, v)),
                            });
                        },
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
