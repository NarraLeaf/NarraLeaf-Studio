import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { getScrollProps } from "./helpers";
import type { ScrollAxis, ScrollWidgetProps } from "./types";

export function createScrollInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { element, documentService } = ctx;

    const patch = (partial: Partial<ScrollWidgetProps>) => {
        documentService.updateElementProps(element.id, {
            ...element.props,
            ...partial,
        });
    };

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.scroll:${element.id}`,
        title: element.name ?? "Scroll",
        fields: [],
        tabs: [
            {
                id: "properties",
                title: "Properties",
                fields: [
                    defineField<D, any>({
                        id: "scroll.axis",
                        type: "select",
                        label: "Scroll axis",
                        options: [
                            { value: "y", label: "Vertical" },
                            { value: "x", label: "Horizontal" },
                        ],
                        getValue: (d: D) => getScrollProps(d.element).axis,
                        setValue: (_d: D, v: string | number) => patch({ axis: v as ScrollAxis }),
                    }),
                ],
            },
        ],
    });
}
