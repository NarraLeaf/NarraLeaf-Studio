import { Type } from "lucide-react";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { getTextProps } from "./helpers";
import type { TextAlign } from "./types";

export function createTextInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { element, documentService } = ctx;

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
                        id: "text.content",
                        type: "textarea",
                        label: "Content",
                        rows: 4,
                        getValue: (d: D) => getTextProps(d.element).text,
                        setValue: (d: D, v: string) => {
                            documentService.updateElementProps(d.element.id, {
                                ...d.element.props,
                                text: v,
                            });
                        },
                    }),
                    defineField<D, any>({
                        id: "text.fontSize",
                        type: "number",
                        label: "Font size",
                        min: 8,
                        max: 256,
                        step: 1,
                        getValue: (d: D) => getTextProps(d.element).fontSize,
                        setValue: (d: D, v: number) => {
                            documentService.updateElementProps(d.element.id, {
                                ...d.element.props,
                                fontSize: v,
                            });
                        },
                    }),
                    defineField<D, any>({
                        id: "text.color",
                        type: "text",
                        label: "Color (hex)",
                        placeholder: "#e5e7eb",
                        getValue: (d: D) => getTextProps(d.element).color,
                        setValue: (d: D, v: string) => {
                            documentService.updateElementProps(d.element.id, {
                                ...d.element.props,
                                color: v,
                            });
                        },
                    }),
                    defineField<D, any>({
                        id: "text.weight",
                        type: "select",
                        label: "Weight",
                        options: [
                            { value: "normal", label: "Normal" },
                            { value: "600", label: "Semibold" },
                            { value: "bold", label: "Bold" },
                        ],
                        getValue: (d: D) => getTextProps(d.element).fontWeight,
                        setValue: (d: D, v: string | number) => {
                            documentService.updateElementProps(d.element.id, {
                                ...d.element.props,
                                fontWeight: v as "normal" | "bold" | "600",
                            });
                        },
                    }),
                    defineField<D, any>({
                        id: "text.align",
                        type: "select",
                        label: "Align",
                        options: [
                            { value: "left", label: "Left" },
                            { value: "center", label: "Center" },
                            { value: "right", label: "Right" },
                        ],
                        getValue: (d: D) => getTextProps(d.element).textAlign,
                        setValue: (d: D, v: string | number) => {
                            documentService.updateElementProps(d.element.id, {
                                ...d.element.props,
                                textAlign: v as TextAlign,
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
