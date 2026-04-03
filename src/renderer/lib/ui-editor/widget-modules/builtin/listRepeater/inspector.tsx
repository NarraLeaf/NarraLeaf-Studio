import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
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
                        id: "listRepeater.previewCount",
                        type: "number",
                        label: "Preview count",
                        min: 1,
                        max: 32,
                        step: 1,
                        getValue: (d: D) => getListRepeaterProps(d.element).previewCount,
                        setValue: (_d: D, v: number) => patch({ previewCount: v }),
                    }),
                    defineField<D, any>({
                        id: "listRepeater.itemGap",
                        type: "number",
                        label: "Item gap",
                        min: 0,
                        max: 128,
                        step: 1,
                        getValue: (d: D) => getListRepeaterProps(d.element).itemGap,
                        setValue: (_d: D, v: number) => patch({ itemGap: v }),
                    }),
                    defineField<D, any>({
                        id: "listRepeater.repeatDirection",
                        type: "select",
                        label: "Repeat direction",
                        options: [
                            { value: "vertical", label: "Vertical" },
                            { value: "horizontal", label: "Horizontal" },
                        ],
                        getValue: (d: D) => getListRepeaterProps(d.element).repeatDirection,
                        setValue: (_d: D, v: string | number) =>
                            patch({ repeatDirection: v as ListRepeaterDirection }),
                    }),
                    defineField<D, any>({
                        id: "listRepeater.templateDirection",
                        type: "select",
                        label: "Template direction",
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
                        type: "number",
                        label: "Template gap",
                        min: 0,
                        max: 128,
                        step: 1,
                        getValue: (d: D) => getListRepeaterProps(d.element).templateGap,
                        setValue: (_d: D, v: number) => patch({ templateGap: v }),
                    }),
                ],
            },
        ],
    });
}
