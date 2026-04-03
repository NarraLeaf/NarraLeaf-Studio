import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
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
                        id: "spacerDivider.mode",
                        type: "select",
                        label: "Mode",
                        options: [
                            { value: "spacer", label: "Spacer" },
                            { value: "divider", label: "Divider" },
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
                        type: "number",
                        label: "Thickness (px)",
                        min: 1,
                        max: 64,
                        step: 1,
                        getValue: (d: D) => getSpacerDividerProps(d.element).thickness,
                        setValue: (_d: D, v: number) => patch({ thickness: v }),
                    }),
                    defineField<D, any>({
                        id: "spacerDivider.color",
                        type: "text",
                        label: "Line color (hex)",
                        placeholder: "#444444",
                        getValue: (d: D) => getSpacerDividerProps(d.element).color,
                        setValue: (_d: D, v: string) => patch({ color: v }),
                    }),
                    defineField<D, any>({
                        id: "spacerDivider.insetStart",
                        type: "number",
                        label: "Inset start (px)",
                        min: 0,
                        max: 256,
                        step: 1,
                        getValue: (d: D) => getSpacerDividerProps(d.element).insetStart,
                        setValue: (_d: D, v: number) => patch({ insetStart: v }),
                    }),
                    defineField<D, any>({
                        id: "spacerDivider.insetEnd",
                        type: "number",
                        label: "Inset end (px)",
                        min: 0,
                        max: 256,
                        step: 1,
                        getValue: (d: D) => getSpacerDividerProps(d.element).insetEnd,
                        setValue: (_d: D, v: number) => patch({ insetEnd: v }),
                    }),
                ],
            },
        ],
    });
}
