import { getSupportedEffectKindsForWidgetType } from "@shared/types/ui-editor/effects";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { CustomFieldProps, InlineRowItemContext } from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { getListProps } from "./helpers";
import type { ListDirection, ListWidgetProps } from "./types";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { StaticEffectsSection } from "@/lib/ui-editor/widget-modules/shared/effects/StaticEffectsSection";

function ListEffectsField(props: CustomFieldProps<UIInspectorData>) {
    const el = props.data.element;
    const live =
        props.data.documentService.getDocument().elements[el.id] ?? el;
    const flat = getListProps(live);
    return (
        <StaticEffectsSection
            effects={flat.effects}
            onChange={next => {
                const docEl =
                    props.data.documentService.getDocument().elements[el.id] ??
                    live;
                props.data.documentService.updateElementProps(el.id, {
                    ...docEl.props,
                    effects: next,
                });
            }}
            supportedKinds={getSupportedEffectKindsForWidgetType("nl.list")}
            draftResetKey={el.id}
        />
    );
}

export function createListInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { element, documentService } = ctx;

    const patch = (partial: Partial<ListWidgetProps>) => {
        documentService.updateElementProps(element.id, {
            ...element.props,
            ...partial,
        });
    };

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.list:${element.id}`,
        title: element.name ?? "List",
        fields: [],
        tabs: [
            {
                id: "properties",
                title: "Properties",
                fields: [
                    defineField<D, any>({
                        id: "section.preview",
                        type: "section",
                        title: "Preview",
                        fields: [
                            defineField<D, any>({
                                id: "list.previewCount",
                                type: "inlineRow",
                                gap: 8,
                                wrap: false,
                                label: "Rows / columns in editor",
                                items: [
                                    {
                                        id: "list.previewCountInput",
                                        className: "flex-1 min-w-0",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const current = getListProps(data.element);
                                            return (
                                                <NumericDraftEnhancedInput
                                                    committedDisplay={String(current.previewCount)}
                                                    draftResetKey={element.id}
                                                    onFiniteNumber={(v) => {
                                                        const clamped = Math.min(32, Math.max(1, Math.round(v)));
                                                        onSaving(true);
                                                        try {
                                                            patch({ previewCount: clamped });
                                                        } finally {
                                                            onSaving(false);
                                                        }
                                                    }}
                                                    inputMode="numeric"
                                                    type="number"
                                                    min={1}
                                                    max={32}
                                                />
                                            );
                                        },
                                    },
                                ],
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.list",
                        type: "section",
                        title: "List layout",
                        fields: [
                            defineField<D, any>({
                                id: "list.repeatDirection",
                                type: "select",
                                label: "Repeat direction",
                                options: [
                                    { value: "vertical", label: "Vertical (stack items)" },
                                    { value: "horizontal", label: "Horizontal (row of items)" },
                                ],
                                getValue: (d: D) => getListProps(d.element).repeatDirection,
                                setValue: (_d: D, v: string | number) =>
                                    patch({ repeatDirection: v as ListDirection }),
                            }),
                            defineField<D, any>({
                                id: "list.itemGap",
                                type: "inlineRow",
                                gap: 8,
                                wrap: false,
                                label: "Space between items",
                                items: [
                                    {
                                        id: "list.itemGapInput",
                                        className: "flex-1 min-w-0",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const current = getListProps(data.element);
                                            return (
                                                <NumericDraftEnhancedInput
                                                    committedDisplay={String(current.itemGap)}
                                                    draftResetKey={element.id}
                                                    onFiniteNumber={(v) => {
                                                        if (v < 0) {
                                                            return;
                                                        }
                                                        onSaving(true);
                                                        try {
                                                            patch({ itemGap: Math.min(128, v) });
                                                        } finally {
                                                            onSaving(false);
                                                        }
                                                    }}
                                                    inputMode="numeric"
                                                    type="number"
                                                    min={0}
                                                    max={128}
                                                    unit="px"
                                                />
                                            );
                                        },
                                    },
                                ],
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.template",
                        type: "section",
                        title: "Item template (inside each cell)",
                        fields: [
                            defineField<D, any>({
                                id: "list.templateDirection",
                                type: "select",
                                label: "Content direction",
                                options: [
                                    { value: "vertical", label: "Vertical" },
                                    { value: "horizontal", label: "Horizontal" },
                                ],
                                getValue: (d: D) => getListProps(d.element).templateDirection,
                                setValue: (_d: D, v: string | number) =>
                                    patch({ templateDirection: v as ListDirection }),
                            }),
                            defineField<D, any>({
                                id: "list.templateGap",
                                type: "inlineRow",
                                gap: 8,
                                wrap: false,
                                label: "Space inside template",
                                items: [
                                    {
                                        id: "list.templateGapInput",
                                        className: "flex-1 min-w-0",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const current = getListProps(data.element);
                                            return (
                                                <NumericDraftEnhancedInput
                                                    committedDisplay={String(current.templateGap)}
                                                    draftResetKey={element.id}
                                                    onFiniteNumber={(v) => {
                                                        if (v < 0) {
                                                            return;
                                                        }
                                                        onSaving(true);
                                                        try {
                                                            patch({ templateGap: Math.min(128, v) });
                                                        } finally {
                                                            onSaving(false);
                                                        }
                                                    }}
                                                    inputMode="numeric"
                                                    type="number"
                                                    min={0}
                                                    max={128}
                                                    unit="px"
                                                />
                                            );
                                        },
                                    },
                                ],
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.effects",
                        type: "section",
                        title: "Effects",
                        collapsible: true,
                        defaultCollapsed: true,
                        fields: [
                            defineField<D, any>({
                                id: "list.effects.panel",
                                type: "custom",
                                component: ListEffectsField,
                            }),
                        ],
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
                        title: "Control blueprint",
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
