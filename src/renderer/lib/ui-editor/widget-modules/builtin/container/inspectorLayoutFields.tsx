import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
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

function ContainerEmptyChildrenHintField(props: CustomFieldProps<UIInspectorData>) {
    const n = props.data.element.childrenIds.length;
    if (n > 0) {
        return null;
    }
    const k = getContainerProps(props.data.element).layoutKind;
    const text =
        k === "free"
            ? "No children yet. Insert via canvas (tool or right-click) or outline → Insert child. Children use absolute X/Y relative to this container."
            : k === "stack"
              ? "No children yet. New widgets append in flex order. Reorder in the outline; canvas drag is disabled for stack children."
              : "No children yet. Content scrolls on the chosen axis; child order follows the outline. Use Insert child or the canvas insert tools.";

    return (
        <p className="text-[11px] leading-snug text-gray-500 border border-white/5 rounded-md px-2 py-1.5 bg-white/[0.02]">
            {text}
        </p>
    );
}

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
            collapsible: true,
            defaultCollapsed: false,
            fields: [
                defineField<D, any>({
                    id: "container.childrenEmptyHint",
                    type: "custom",
                    component: ContainerEmptyChildrenHintField,
                }),
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
                                    <div className="flex min-w-0 flex-col gap-1">
                                        <span className="text-xs font-medium text-gray-400">Gap</span>
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
                                            aria-label="Gap between children"
                                            title="Gap between children"
                                        />
                                    </div>
                                );
                            },
                        },
                        {
                            id: "container.stackPadding",
                            className: "flex-1 min-w-0",
                            render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                const current = getContainerProps(data.element);
                                return (
                                    <div className="flex min-w-0 flex-col gap-1">
                                        <span className="text-xs font-medium text-gray-400">Padding</span>
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
                                            aria-label="Padding on all sides"
                                            title="Padding (all sides)"
                                        />
                                    </div>
                                );
                            },
                        },
                    ],
                }),
                defineField<D, any>({
                    id: "container.clipContent",
                    type: "select",
                    label: "Overflow",
                    options: [
                        { value: "hidden", label: "Hidden" },
                        { value: "visible", label: "Visible" },
                    ],
                    getValue: (d: D) => (getContainerProps(d.element).clipContent ? "hidden" : "visible"),
                    setValue: (_d: D, v: string | number) => patch({ clipContent: String(v) === "hidden" }),
                }),
            ],
        }),
    ];
}
