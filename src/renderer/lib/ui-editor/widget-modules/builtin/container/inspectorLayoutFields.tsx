import {
    AlignHorizontalJustifyCenter,
    AlignHorizontalJustifyEnd,
    AlignHorizontalJustifyStart,
    AlignVerticalJustifyCenter,
    AlignVerticalJustifyEnd,
    AlignVerticalJustifyStart,
    AlignVerticalSpaceAround,
    AlignVerticalSpaceBetween,
    Columns2,
    Rows2,
    StretchHorizontal,
} from "lucide-react";
import { defineField } from "@/apps/workspace/modules/properties/framework";
import type {
    IconButtonSelection,
    InlineRowItemContext,
} from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import type {
    ContainerLayoutKind,
    ContainerScrollAxis,
    ContainerStackAlignItems,
    ContainerStackDirection,
    ContainerStackJustifyContent,
    ContainerWidgetProps,
} from "@shared/types/ui-editor/container";
import { getContainerProps } from "./helpers";

type D = UIInspectorData;

export function buildContainerLayoutLeadingFields(ctx: InspectorContext): unknown[] {
    const { element, documentService } = ctx;

    const patch = (partial: Partial<ContainerWidgetProps>) => {
        documentService.updateElementProps(element.id, {
            ...element.props,
            ...partial,
        });
    };

    return [
        defineField<D, any>({
            id: "section.containerLayout",
            type: "section",
            title: "Child layout",
            fields: [
                defineField<D, any>({
                    id: "container.layoutKind",
                    type: "select",
                    label: "Mode",
                    options: [
                        { value: "free", label: "Free (absolute children)" },
                        { value: "stack", label: "Stack (flex)" },
                        { value: "scroll", label: "Scroll" },
                    ],
                    getValue: (d: D) => getContainerProps(d.element).layoutKind,
                    setValue: (_d: D, v: string | number) => patch({ layoutKind: v as ContainerLayoutKind }),
                }),
                defineField<D, any>({
                    id: "container.scrollAxis",
                    type: "select",
                    label: "Scroll axis",
                    options: [
                        { value: "y", label: "Vertical" },
                        { value: "x", label: "Horizontal" },
                    ],
                    visible: (d: D) => getContainerProps(d.element).layoutKind === "scroll",
                    getValue: (d: D) => getContainerProps(d.element).scrollAxis,
                    setValue: (_d: D, v: string | number) => patch({ scrollAxis: v as ContainerScrollAxis }),
                }),
                defineField<D, any>({
                    id: "container.stackDirection",
                    type: "iconButtonGroup",
                    mode: "single",
                    label: "Direction",
                    showLabels: false,
                    visible: (d: D) => {
                        const k = getContainerProps(d.element).layoutKind;
                        return k === "stack" || k === "scroll";
                    },
                    options: [
                        { id: "vertical", icon: <Rows2 className="w-4 h-4" />, label: "Vertical stack" },
                        { id: "horizontal", icon: <Columns2 className="w-4 h-4" />, label: "Horizontal stack" },
                    ],
                    getValue: (d: D) => getContainerProps(d.element).stackDirection,
                    setValue: (_d: D, value: IconButtonSelection) => {
                        if (typeof value !== "string") return;
                        patch({ stackDirection: value as ContainerStackDirection });
                    },
                }),
                defineField<D, any>({
                    id: "container.stackAlignItems",
                    type: "iconButtonGroup",
                    mode: "single",
                    label: "Align (cross axis)",
                    showLabels: false,
                    visible: (d: D) => {
                        const k = getContainerProps(d.element).layoutKind;
                        return k === "stack" || k === "scroll";
                    },
                    options: [
                        { id: "start", icon: <AlignHorizontalJustifyStart className="w-4 h-4" />, label: "Start" },
                        { id: "center", icon: <AlignHorizontalJustifyCenter className="w-4 h-4" />, label: "Center" },
                        { id: "end", icon: <AlignHorizontalJustifyEnd className="w-4 h-4" />, label: "End" },
                        { id: "stretch", icon: <StretchHorizontal className="w-4 h-4" />, label: "Stretch" },
                    ],
                    getValue: (d: D) => getContainerProps(d.element).stackAlignItems,
                    setValue: (_d: D, value: IconButtonSelection) => {
                        if (typeof value !== "string") return;
                        patch({ stackAlignItems: value as ContainerStackAlignItems });
                    },
                }),
                defineField<D, any>({
                    id: "container.stackJustifyContent",
                    type: "iconButtonGroup",
                    mode: "single",
                    label: "Justify (main axis)",
                    showLabels: false,
                    visible: (d: D) => {
                        const k = getContainerProps(d.element).layoutKind;
                        return k === "stack" || k === "scroll";
                    },
                    options: [
                        { id: "start", icon: <AlignVerticalJustifyStart className="w-4 h-4" />, label: "Start" },
                        { id: "center", icon: <AlignVerticalJustifyCenter className="w-4 h-4" />, label: "Center" },
                        { id: "end", icon: <AlignVerticalJustifyEnd className="w-4 h-4" />, label: "End" },
                        { id: "space-between", icon: <AlignVerticalSpaceBetween className="w-4 h-4" />, label: "Space between" },
                        { id: "space-around", icon: <AlignVerticalSpaceAround className="w-4 h-4" />, label: "Space around" },
                    ],
                    getValue: (d: D) => getContainerProps(d.element).stackJustifyContent,
                    setValue: (_d: D, value: IconButtonSelection) => {
                        if (typeof value !== "string") return;
                        patch({ stackJustifyContent: value as ContainerStackJustifyContent });
                    },
                }),
                defineField<D, any>({
                    id: "container.stackSpacingRow",
                    type: "inlineRow",
                    gap: 8,
                    wrap: true,
                    label: undefined,
                    visible: (d: D) => {
                        const k = getContainerProps(d.element).layoutKind;
                        return k === "stack" || k === "scroll";
                    },
                    items: [
                        {
                            id: "container.stackGap",
                            className: "flex-1 min-w-0",
                            render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                const current = getContainerProps(data.element);
                                return (
                                    <NumericDraftEnhancedInput
                                        committedDisplay={String(current.stackGap)}
                                        draftResetKey={element.id}
                                        onFiniteNumber={(v) => {
                                            if (v < 0) return;
                                            onSaving(true);
                                            try {
                                                patch({ stackGap: Math.min(256, v) });
                                            } finally {
                                                onSaving(false);
                                            }
                                        }}
                                        inputMode="numeric"
                                        type="number"
                                        min={0}
                                        max={256}
                                        unit="px"
                                        title="Gap between children"
                                    />
                                );
                            },
                        },
                        {
                            id: "container.stackPadding",
                            className: "flex-1 min-w-0",
                            render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                const current = getContainerProps(data.element);
                                return (
                                    <NumericDraftEnhancedInput
                                        committedDisplay={String(current.stackPaddingTop)}
                                        draftResetKey={element.id}
                                        onFiniteNumber={(v) => {
                                            if (v < 0) return;
                                            const clamped = Math.min(256, v);
                                            onSaving(true);
                                            try {
                                                patch({
                                                    stackPaddingTop: clamped,
                                                    stackPaddingRight: clamped,
                                                    stackPaddingBottom: clamped,
                                                    stackPaddingLeft: clamped,
                                                });
                                            } finally {
                                                onSaving(false);
                                            }
                                        }}
                                        inputMode="numeric"
                                        type="number"
                                        min={0}
                                        max={256}
                                        unit="px"
                                        title="Padding (all sides)"
                                    />
                                );
                            },
                        },
                    ],
                }),
            ],
        }),
        defineField<D, any>({
            id: "section.containerBehavior",
            type: "section",
            title: "Behavior",
            fields: [
                defineField<D, any>({
                    id: "container.clipContent",
                    type: "checkbox",
                    label: "Clip content",
                    getValue: (d: D) => getContainerProps(d.element).clipContent,
                    setValue: (_d: D, v: boolean) => patch({ clipContent: v }),
                }),
            ],
        }),
    ];
}
