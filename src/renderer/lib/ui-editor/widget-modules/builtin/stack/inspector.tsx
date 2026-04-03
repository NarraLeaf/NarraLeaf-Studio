import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { getStackProps } from "./helpers";
import type { StackAlignItems, StackDirection, StackJustifyContent, StackWidgetProps } from "./types";

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
                        id: "stack.direction",
                        type: "select",
                        label: "Direction",
                        options: [
                            { value: "vertical", label: "Vertical" },
                            { value: "horizontal", label: "Horizontal" },
                        ],
                        getValue: (d: D) => getStackProps(d.element).direction,
                        setValue: (_d: D, v: string | number) => patch({ direction: v as StackDirection }),
                    }),
                    defineField<D, any>({
                        id: "stack.gap",
                        type: "number",
                        label: "Gap",
                        min: 0,
                        max: 256,
                        step: 1,
                        getValue: (d: D) => getStackProps(d.element).gap,
                        setValue: (_d: D, v: number) => patch({ gap: v }),
                    }),
                    defineField<D, any>({
                        id: "stack.padding",
                        type: "number",
                        label: "Padding (all sides)",
                        min: 0,
                        max: 256,
                        step: 1,
                        getValue: (d: D) => {
                            const p = getStackProps(d.element);
                            return p.paddingTop;
                        },
                        setValue: (_d: D, v: number) =>
                            patch({
                                paddingTop: v,
                                paddingRight: v,
                                paddingBottom: v,
                                paddingLeft: v,
                            }),
                    }),
                    defineField<D, any>({
                        id: "stack.alignItems",
                        type: "select",
                        label: "Align (cross axis)",
                        options: [
                            { value: "start", label: "Start" },
                            { value: "center", label: "Center" },
                            { value: "end", label: "End" },
                            { value: "stretch", label: "Stretch" },
                        ],
                        getValue: (d: D) => getStackProps(d.element).alignItems,
                        setValue: (_d: D, v: string | number) => patch({ alignItems: v as StackAlignItems }),
                    }),
                    defineField<D, any>({
                        id: "stack.justifyContent",
                        type: "select",
                        label: "Justify (main axis)",
                        options: [
                            { value: "start", label: "Start" },
                            { value: "center", label: "Center" },
                            { value: "end", label: "End" },
                            { value: "space-between", label: "Space between" },
                            { value: "space-around", label: "Space around" },
                        ],
                        getValue: (d: D) => getStackProps(d.element).justifyContent,
                        setValue: (_d: D, v: string | number) =>
                            patch({ justifyContent: v as StackJustifyContent }),
                    }),
                ],
            },
        ],
    });
}
