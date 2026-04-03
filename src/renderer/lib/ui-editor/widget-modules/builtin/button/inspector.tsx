import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
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
                        id: "button.bg",
                        type: "text",
                        label: "Background (hex)",
                        getValue: (d: D) => getButtonProps(d.element).backgroundColor,
                        setValue: (_d: D, v: string) => patch({ backgroundColor: v }),
                    }),
                    defineField<D, any>({
                        id: "button.radius",
                        type: "number",
                        label: "Corner radius",
                        min: 0,
                        max: 999,
                        step: 1,
                        getValue: (d: D) => getButtonProps(d.element).borderRadius,
                        setValue: (_d: D, v: number) => patch({ borderRadius: v }),
                    }),
                    defineField<D, any>({
                        id: "button.padX",
                        type: "number",
                        label: "Padding X",
                        min: 0,
                        max: 128,
                        step: 1,
                        getValue: (d: D) => getButtonProps(d.element).paddingX,
                        setValue: (_d: D, v: number) => patch({ paddingX: v }),
                    }),
                    defineField<D, any>({
                        id: "button.padY",
                        type: "number",
                        label: "Padding Y",
                        min: 0,
                        max: 128,
                        step: 1,
                        getValue: (d: D) => getButtonProps(d.element).paddingY,
                        setValue: (_d: D, v: number) => patch({ paddingY: v }),
                    }),
                    defineField<D, any>({
                        id: "button.borderWidth",
                        type: "number",
                        label: "Border width",
                        min: 0,
                        max: 64,
                        step: 1,
                        getValue: (d: D) => getButtonProps(d.element).borderWidth,
                        setValue: (_d: D, v: number) => patch({ borderWidth: v }),
                    }),
                    defineField<D, any>({
                        id: "button.borderColor",
                        type: "text",
                        label: "Border color (hex)",
                        getValue: (d: D) => getButtonProps(d.element).borderColor,
                        setValue: (_d: D, v: string) => patch({ borderColor: v }),
                    }),
                    defineField<D, any>({
                        id: "button.borderStyle",
                        type: "select",
                        label: "Border style",
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
                        id: "button.clip",
                        type: "checkbox",
                        label: "Clip content",
                        getValue: (d: D) => getButtonProps(d.element).clipContent,
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
