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
import {
    clampContainerStackSpacingPx,
    CONTAINER_STACK_SPACING_ABS_MAX_PX,
    type ContainerLayoutKind,
    type ContainerScrollAxis,
    type ContainerStackAlignItems,
    type ContainerStackDirection,
    type ContainerStackJustifyContent,
    type ContainerWidgetProps,
} from "@shared/types/ui-editor/container";
import { ContainerStackPaddingEditor } from "./ContainerStackPaddingEditor";
import { i18nStore } from "@/lib/i18n";
import { getContainerProps } from "./helpers";

type D = UIInspectorData;

function ContainerEmptyChildrenHintField(props: CustomFieldProps<UIInspectorData>) {
    return null;
}

export function buildContainerLayoutLeadingFields(ctx: InspectorContext): unknown[] {
    const { t } = i18nStore.getTranslator();
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
            title: t("widgets.container.childLayout"),
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
                    label: t("widgets.container.mode"),
                    options: [
                        { value: "free", label: t("widgets.container.modeFree") },
                        { value: "stack", label: t("widgets.container.modeStack") },
                        { value: "scroll", label: t("widgets.container.modeScroll") },
                    ],
                    getValue: (d: D) => getContainerProps(d.element).layoutKind,
                    setValue: (_d: D, v: string | number) => patch({ layoutKind: v as ContainerLayoutKind }),
                }),
                defineField<D, any>({
                    id: "container.scrollAxis",
                    type: "select",
                    label: t("widgets.container.scrollAxis"),
                    options: [
                        { value: "y", label: t("widgets.vertical") },
                        { value: "x", label: t("widgets.horizontal") },
                    ],
                    visible: (d: D) => getContainerProps(d.element).layoutKind === "scroll",
                    getValue: (d: D) => getContainerProps(d.element).scrollAxis,
                    setValue: (_d: D, v: string | number) => patch({ scrollAxis: v as ContainerScrollAxis }),
                }),
                defineField<D, any>({
                    id: "container.stackDirection",
                    type: "iconButtonGroup",
                    mode: "single",
                    label: t("widgets.direction"),
                    showLabels: false,
                    visible: (d: D) => {
                        const k = getContainerProps(d.element).layoutKind;
                        return k === "stack" || k === "scroll";
                    },
                    options: [
                        { id: "vertical", icon: <Rows2 className="w-4 h-4" />, label: t("widgets.container.verticalStack") },
                        { id: "horizontal", icon: <Columns2 className="w-4 h-4" />, label: t("widgets.container.horizontalStack") },
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
                    label: t("widgets.container.alignCross"),
                    showLabels: false,
                    visible: (d: D) => {
                        const k = getContainerProps(d.element).layoutKind;
                        return k === "stack" || k === "scroll";
                    },
                    options: [
                        { id: "start", icon: <AlignHorizontalJustifyStart className="w-4 h-4" />, label: t("widgets.container.start") },
                        { id: "center", icon: <AlignHorizontalJustifyCenter className="w-4 h-4" />, label: t("widgets.container.center") },
                        { id: "end", icon: <AlignHorizontalJustifyEnd className="w-4 h-4" />, label: t("widgets.container.end") },
                        { id: "stretch", icon: <StretchHorizontal className="w-4 h-4" />, label: t("widgets.container.stretch") },
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
                    label: t("widgets.container.justifyMain"),
                    showLabels: false,
                    visible: (d: D) => {
                        const k = getContainerProps(d.element).layoutKind;
                        return k === "stack" || k === "scroll";
                    },
                    options: [
                        { id: "start", icon: <AlignVerticalJustifyStart className="w-4 h-4" />, label: t("widgets.container.start") },
                        { id: "center", icon: <AlignVerticalJustifyCenter className="w-4 h-4" />, label: t("widgets.container.center") },
                        { id: "end", icon: <AlignVerticalJustifyEnd className="w-4 h-4" />, label: t("widgets.container.end") },
                        { id: "space-between", icon: <AlignVerticalSpaceBetween className="w-4 h-4" />, label: t("widgets.container.spaceBetween") },
                        { id: "space-around", icon: <AlignVerticalSpaceAround className="w-4 h-4" />, label: t("widgets.container.spaceAround") },
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
                                        <span className="text-xs font-medium text-fg-muted">{t("widgets.gap")}</span>
                                        <NumericDraftEnhancedInput
                                            committedDisplay={String(current.stackGap)}
                                            draftResetKey={element.id}
                                            onFiniteNumber={(v) => {
                                                const next = clampContainerStackSpacingPx(v);
                                                onSaving(true);
                                                try {
                                                    patch({ stackGap: next });
                                                } finally {
                                                    onSaving(false);
                                                }
                                            }}
                                            inputMode="numeric"
                                            type="number"
                                            min={-CONTAINER_STACK_SPACING_ABS_MAX_PX}
                                            max={CONTAINER_STACK_SPACING_ABS_MAX_PX}
                                            unit="px"
                                            aria-label={t("widgets.container.gapHint")}
                                            title={t("widgets.container.gapHint")}
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
                                    <ContainerStackPaddingEditor
                                        current={current}
                                        draftResetKey={element.id}
                                        onSaving={onSaving}
                                        onPatch={patch}
                                    />
                                );
                            },
                        },
                    ],
                }),
                defineField<D, any>({
                    id: "container.clipContent",
                    type: "select",
                    label: t("widgets.container.overflow"),
                    options: [
                        { value: "hidden", label: t("widgets.container.overflowHidden") },
                        { value: "visible", label: t("widgets.container.overflowVisible") },
                    ],
                    getValue: (d: D) => (getContainerProps(d.element).clipContent ? "hidden" : "visible"),
                    setValue: (_d: D, v: string | number) => patch({ clipContent: String(v) === "hidden" }),
                }),
            ],
        }),
    ];
}
