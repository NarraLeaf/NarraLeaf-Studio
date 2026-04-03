import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
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
                        id: "container.bg",
                        type: "text",
                        label: "Background (hex)",
                        placeholder: "#000000",
                        getValue: (d: D) => getContainerProps(d.element).backgroundColor,
                        setValue: (_d: D, v: string) => patch({ backgroundColor: v }),
                    }),
                    defineField<D, any>({
                        id: "container.radius",
                        type: "number",
                        label: "Corner radius",
                        min: 0,
                        max: 999,
                        step: 1,
                        getValue: (d: D) => getContainerProps(d.element).borderRadius,
                        setValue: (_d: D, v: number) => patch({ borderRadius: v }),
                    }),
                    defineField<D, any>({
                        id: "container.borderWidth",
                        type: "number",
                        label: "Border width",
                        min: 0,
                        max: 64,
                        step: 1,
                        getValue: (d: D) => getContainerProps(d.element).borderWidth,
                        setValue: (_d: D, v: number) => patch({ borderWidth: v }),
                    }),
                    defineField<D, any>({
                        id: "container.borderColor",
                        type: "text",
                        label: "Border color (hex)",
                        getValue: (d: D) => getContainerProps(d.element).borderColor,
                        setValue: (_d: D, v: string) => patch({ borderColor: v }),
                    }),
                    defineField<D, any>({
                        id: "container.borderStyle",
                        type: "select",
                        label: "Border style",
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
                        id: "container.clip",
                        type: "checkbox",
                        label: "Clip content",
                        getValue: (d: D) => getContainerProps(d.element).clipContent,
                        setValue: (_d: D, v: boolean) => patch({ clipContent: v }),
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
