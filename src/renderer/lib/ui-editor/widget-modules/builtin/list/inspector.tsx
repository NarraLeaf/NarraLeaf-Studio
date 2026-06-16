import { getSupportedEffectKindsForWidgetType } from "@shared/types/ui-editor/effects";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type {
    ColorValue,
    CustomFieldProps,
    InlineRowItemContext,
} from "@/apps/workspace/modules/properties/framework/types";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { getListProps } from "./helpers";
import type { ListDirection, ListWidgetProps } from "./types";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { StaticEffectsSection } from "@/lib/ui-editor/widget-modules/shared/effects/StaticEffectsSection";
import type {
    UIListItemsBinding,
    UIListScrollbarPartStyle,
    UIListScrollbarProps,
} from "@shared/types/ui-editor/list";

function ScrollbarCustomizeField(props: CustomFieldProps<UIInspectorData>) {
    const { element, documentService, surfaceId } = props.data;
    const live = documentService.getDocument().elements[element.id] ?? element;
    const listProps = getListProps(live);
    const hasAuthoredParts = Boolean(listProps.scrollbar.trackElementId && listProps.scrollbar.thumbElementId);

    const createParts = () => {
        const action = () => {
            const track = documentService.createElement(element.id, "nl.container", {
                x: 0,
                y: 0,
                width: listProps.scrollbar.thickness,
                height: Math.max(32, element.layout.height - listProps.scrollbar.contentInset * 2),
            });
            documentService.updateElementExtra(track.id, { listSlot: "scrollbarTrack" });
            documentService.updateElementProps(track.id, {
                layoutKind: "free",
                ...listProps.scrollbar.trackStyle,
                clipContent: true,
            });

            const thumb = documentService.createElement(element.id, "nl.container", {
                x: 0,
                y: 0,
                width: listProps.scrollbar.thickness,
                height: listProps.scrollbar.minThumbLength,
            });
            documentService.updateElementExtra(thumb.id, { listSlot: "scrollbarThumb" });
            documentService.updateElementProps(thumb.id, {
                layoutKind: "free",
                ...listProps.scrollbar.thumbStyle,
                clipContent: true,
            });

            const nextScrollbar: UIListScrollbarProps = {
                ...listProps.scrollbar,
                trackElementId: track.id,
                thumbElementId: thumb.id,
            };
            documentService.updateElementProps(element.id, {
                ...(documentService.getDocument().elements[element.id]?.props ?? element.props),
                scrollbar: nextScrollbar,
            });
        };

        if (surfaceId) {
            documentService.runSurfaceHistoryTransaction(surfaceId, action);
        } else {
            action();
        }
    };

    return (
        <div className="space-y-2">
            <button
                type="button"
                className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-gray-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={hasAuthoredParts}
                onClick={createParts}
            >
                {hasAuthoredParts ? "Scrollbar parts created" : "Customize scrollbar"}
            </button>
            {hasAuthoredParts ? (
                <p className="text-[10px] leading-snug text-gray-500">
                    Track and thumb are authored elements in the list outline. Select them to edit their appearance.
                </p>
            ) : (
                <p className="text-[10px] leading-snug text-gray-500">
                    Creates authored track and thumb elements without changing the item template.
                </p>
            )}
        </div>
    );
}

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
        const live = documentService.getDocument().elements[element.id] ?? element;
        documentService.updateElementProps(element.id, {
            ...live.props,
            ...partial,
        });
    };

    const patchScrollbar = (partial: Partial<UIListScrollbarProps>) => {
        const current = getListProps(documentService.getDocument().elements[element.id] ?? element);
        patch({
            scrollbar: {
                ...current.scrollbar,
                ...partial,
            },
        });
    };

    const patchScrollbarPart = (part: "trackStyle" | "thumbStyle", partial: Partial<UIListScrollbarPartStyle>) => {
        const current = getListProps(documentService.getDocument().elements[element.id] ?? element);
        patchScrollbar({
            [part]: {
                ...current.scrollbar[part],
                ...partial,
            },
        } as Partial<UIListScrollbarProps>);
    };

    const patchItemsBinding = (partial: Partial<UIListItemsBinding> | null) => {
        const current = getListProps(documentService.getDocument().elements[element.id] ?? element);
        if (partial === null) {
            patch({ itemsBinding: null });
            return;
        }
        const base = current.itemsBinding ?? { kind: "surfaceState" as const, key: "" };
        patch({ itemsBinding: { ...base, ...partial } as UIListItemsBinding });
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
                        title: "Data",
                        fields: [
                            defineField<D, any>({
                                id: "list.itemsBindingScope",
                                type: "select",
                                label: "Items source",
                                options: [
                                    { value: "none", label: "Preview only" },
                                    { value: "surfaceState", label: "Page state array" },
                                    { value: "globalState", label: "App state array" },
                                ],
                                getValue: (d: D) => getListProps(d.element).itemsBinding?.kind ?? "none",
                                setValue: (_d: D, v: string | number) => {
                                    if (v === "none") {
                                        patchItemsBinding(null);
                                    } else {
                                        patchItemsBinding({ kind: v as UIListItemsBinding["kind"] });
                                    }
                                },
                            }),
                            defineField<D, any>({
                                id: "list.itemsBindingKey",
                                type: "text",
                                label: "State key",
                                placeholder: "choices",
                                getValue: (d: D) => getListProps(d.element).itemsBinding?.key ?? "",
                                setValue: (_d: D, v: string) => patchItemsBinding({ key: v }),
                            }),
                            defineField<D, any>({
                                id: "list.itemKeyPath",
                                type: "text",
                                label: "Item key path",
                                placeholder: "id",
                                getValue: (d: D) => getListProps(d.element).itemKeyPath ?? "id",
                                setValue: (_d: D, v: string) => patch({ itemKeyPath: v }),
                            }),
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
                            defineField<D, any>({
                                id: "list.previewItems",
                                type: "textarea",
                                rows: 5,
                                label: "Preview items JSON",
                                getValue: (d: D) => JSON.stringify(getListProps(d.element).previewItems ?? [], null, 2),
                                setValue: (_d: D, v: string) => {
                                    try {
                                        const parsed = JSON.parse(v);
                                        if (Array.isArray(parsed)) {
                                            patch({ previewItems: parsed });
                                        }
                                    } catch {
                                        // Keep the last valid preview data while the user is typing.
                                    }
                                },
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
                            defineField<D, any>({
                                id: "list.padding",
                                type: "inputGroup",
                                label: "Content padding",
                                gap: 6,
                                wrap: true,
                                inputs: [
                                    {
                                        id: "top",
                                        label: "T",
                                        type: "number",
                                        getValue: (d: D) => String(getListProps(d.element).contentPaddingTop),
                                        setValue: (_d: D, v: string) => patch({ contentPaddingTop: Math.max(0, Number(v) || 0) }),
                                    },
                                    {
                                        id: "right",
                                        label: "R",
                                        type: "number",
                                        getValue: (d: D) => String(getListProps(d.element).contentPaddingRight),
                                        setValue: (_d: D, v: string) => patch({ contentPaddingRight: Math.max(0, Number(v) || 0) }),
                                    },
                                    {
                                        id: "bottom",
                                        label: "B",
                                        type: "number",
                                        getValue: (d: D) => String(getListProps(d.element).contentPaddingBottom),
                                        setValue: (_d: D, v: string) => patch({ contentPaddingBottom: Math.max(0, Number(v) || 0) }),
                                    },
                                    {
                                        id: "left",
                                        label: "L",
                                        type: "number",
                                        getValue: (d: D) => String(getListProps(d.element).contentPaddingLeft),
                                        setValue: (_d: D, v: string) => patch({ contentPaddingLeft: Math.max(0, Number(v) || 0) }),
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
                        id: "section.scrollbar",
                        type: "section",
                        title: "Scrollbar",
                        collapsible: true,
                        defaultCollapsed: false,
                        fields: [
                            defineField<D, any>({
                                id: "list.scrollbar.enabled",
                                type: "checkbox",
                                label: "Enabled",
                                getValue: (d: D) => getListProps(d.element).scrollbar.enabled,
                                setValue: (_d: D, v: boolean) => patchScrollbar({ enabled: v }),
                            }),
                            defineField<D, any>({
                                id: "list.scrollbar.side",
                                type: "select",
                                label: "Side",
                                options: [
                                    { value: "right", label: "Right" },
                                    { value: "left", label: "Left" },
                                    { value: "bottom", label: "Bottom" },
                                    { value: "top", label: "Top" },
                                ],
                                getValue: (d: D) => getListProps(d.element).scrollbar.side,
                                setValue: (_d: D, v: string | number) => patchScrollbar({ side: String(v) as UIListScrollbarProps["side"] }),
                            }),
                            defineField<D, any>({
                                id: "list.scrollbar.visibility",
                                type: "select",
                                label: "Visibility",
                                options: [
                                    { value: "auto", label: "Auto" },
                                    { value: "always", label: "Always" },
                                    { value: "hidden", label: "Hidden" },
                                ],
                                getValue: (d: D) => getListProps(d.element).scrollbar.visibility,
                                setValue: (_d: D, v: string | number) => patchScrollbar({ visibility: String(v) as UIListScrollbarProps["visibility"] }),
                            }),
                            defineField<D, any>({
                                id: "list.scrollbar.metrics",
                                type: "inputGroup",
                                label: "Metrics",
                                gap: 6,
                                wrap: true,
                                inputs: [
                                    {
                                        id: "thickness",
                                        label: "W",
                                        type: "number",
                                        getValue: (d: D) => String(getListProps(d.element).scrollbar.thickness),
                                        setValue: (_d: D, v: string) => patchScrollbar({ thickness: Math.max(2, Number(v) || 8) }),
                                    },
                                    {
                                        id: "inset",
                                        label: "Inset",
                                        type: "number",
                                        getValue: (d: D) => String(getListProps(d.element).scrollbar.contentInset),
                                        setValue: (_d: D, v: string) => patchScrollbar({ contentInset: Math.max(0, Number(v) || 0) }),
                                    },
                                    {
                                        id: "minThumb",
                                        label: "Min",
                                        type: "number",
                                        getValue: (d: D) => String(getListProps(d.element).scrollbar.minThumbLength),
                                        setValue: (_d: D, v: string) => patchScrollbar({ minThumbLength: Math.max(8, Number(v) || 24) }),
                                    },
                                ],
                            }),
                            defineField<D, any>({
                                id: "list.scrollbar.trackColor",
                                type: "colorPicker",
                                label: "Track color",
                                displayMode: "icon-hex",
                                allowOpacity: false,
                                getValue: (d: D) => ({ hex: getListProps(d.element).scrollbar.trackStyle.backgroundColor }),
                                setValue: (_d: D, value: ColorValue) => patchScrollbarPart("trackStyle", { backgroundColor: value.hex, fillType: "color" }),
                            }),
                            defineField<D, any>({
                                id: "list.scrollbar.trackImage",
                                type: "imageFill",
                                label: "Track image",
                                getValue: (d: D) => getListProps(d.element).scrollbar.trackStyle.imageFill ?? undefined,
                                setValue: (_d: D, value: ImageFill) => patchScrollbarPart("trackStyle", { imageFill: value, fillType: "image" }),
                            }),
                            defineField<D, any>({
                                id: "list.scrollbar.thumbColor",
                                type: "colorPicker",
                                label: "Thumb color",
                                displayMode: "icon-hex",
                                allowOpacity: false,
                                getValue: (d: D) => ({ hex: getListProps(d.element).scrollbar.thumbStyle.backgroundColor }),
                                setValue: (_d: D, value: ColorValue) => patchScrollbarPart("thumbStyle", { backgroundColor: value.hex, fillType: "color" }),
                            }),
                            defineField<D, any>({
                                id: "list.scrollbar.thumbImage",
                                type: "imageFill",
                                label: "Thumb image",
                                getValue: (d: D) => getListProps(d.element).scrollbar.thumbStyle.imageFill ?? undefined,
                                setValue: (_d: D, value: ImageFill) => patchScrollbarPart("thumbStyle", { imageFill: value, fillType: "image" }),
                            }),
                            defineField<D, any>({
                                id: "list.scrollbar.customize",
                                type: "custom",
                                component: ScrollbarCustomizeField,
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
                        id: "interaction.blueprint.readonly",
                        type: "custom",
                        label: "Control blueprint",
                        component: ReadonlyBlueprintSection,
                    }),
                ],
            },
        ],
    });
}
