import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { getSupportedEffectKindsForWidgetType } from "@shared/types/ui-editor/effects";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type {
    ColorValue,
    CustomFieldProps,
    InlineRowItemContext,
} from "@/apps/workspace/modules/properties/framework/types";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import { defaultContainerWidgetProps } from "@shared/types/ui-editor/container";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { Button } from "@/lib/components/elements/Button";
import { Select } from "@/lib/components/elements/Select";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { getListProps } from "./helpers";
import type { ListDirection, ListWidgetProps } from "./types";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { StaticEffectsSection } from "@/lib/ui-editor/widget-modules/shared/effects/StaticEffectsSection";
import { createInitialContainerAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { CompactModuleCard } from "@/lib/ui-editor/widget-modules/shared/appearance/compact/CompactModuleCard";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import type {
    UIListItemsBinding,
    UIListScrollbarPartStyle,
    UIListScrollbarProps,
} from "@shared/types/ui-editor/list";

function scrollbarPartContainerProps(style: UIListScrollbarPartStyle): Record<string, unknown> {
    const props = {
        ...defaultContainerWidgetProps,
        layoutKind: "free" as const,
        clipContent: true,
        backgroundColor: style.backgroundColor,
        fillType: style.fillType,
        imageFill: style.imageFill ?? null,
        backgroundImage: style.backgroundImage,
        backgroundFit: style.backgroundFit,
        fillOpacity: style.fillOpacity,
        borderRadius: style.borderRadius,
        borderRadiusTL: style.borderRadius,
        borderRadiusTR: style.borderRadius,
        borderRadiusBL: style.borderRadius,
        borderRadiusBR: style.borderRadius,
        borderRadiusLinked: true,
        borderColor: style.borderColor,
        borderWidth: style.borderWidth,
        borderStyle: style.borderStyle,
        strokeVisible: style.borderWidth > 0,
        strokeOpacity: 1,
        strokeAlign: "inside" as const,
        strokeSide: "all",
        borderJoin: "round" as const,
    };
    return {
        ...props,
        appearance: createInitialContainerAppearance(props),
    };
}

const LIST_SPACING_MAX_PX = 512;

const directionOptions = [
    { value: "vertical", label: "Vertical" },
    { value: "horizontal", label: "Horizontal" },
];

const scrollbarSideOptions = [
    { value: "right", label: "Right" },
    { value: "left", label: "Left" },
    { value: "bottom", label: "Bottom" },
    { value: "top", label: "Top" },
];

const scrollbarVisibilityOptions = [
    { value: "auto", label: "Auto" },
    { value: "always", label: "Always" },
    { value: "hidden", label: "Hidden" },
];

function clampListSpacingPx(value: number, max = LIST_SPACING_MAX_PX): number {
    return Math.max(0, Math.min(max, value));
}

function clampListMetricPx(value: number, min: number, max = LIST_SPACING_MAX_PX): number {
    return Math.max(min, Math.min(max, value));
}

function getLiveListProps(data: UIInspectorData): ListWidgetProps {
    const live = data.documentService.getDocument().elements[data.element.id] ?? data.element;
    return getListProps(live);
}

function patchListProps(data: UIInspectorData, partial: Partial<ListWidgetProps>): void {
    const live = data.documentService.getDocument().elements[data.element.id] ?? data.element;
    data.documentService.updateElementProps(data.element.id, {
        ...live.props,
        ...partial,
    });
}

function patchListScrollbarProps(data: UIInspectorData, partial: Partial<UIListScrollbarProps>): void {
    const current = getLiveListProps(data);
    patchListProps(data, {
        scrollbar: {
            ...current.scrollbar,
            ...partial,
        },
    });
}

function FieldLabel({ children }: { children: string }) {
    return <span className="text-xs font-medium text-fg-muted">{children}</span>;
}

function ListNumberControl({
    label,
    value,
    draftResetKey,
    onFiniteNumber,
    min = 0,
    max = LIST_SPACING_MAX_PX,
    unit = "px",
}: {
    label: string;
    value: number;
    draftResetKey: string;
    onFiniteNumber: (value: number) => void;
    min?: number;
    max?: number;
    unit?: string;
}) {
    return (
        <div className="flex min-w-[6rem] flex-1 flex-col gap-1">
            <FieldLabel>{label}</FieldLabel>
            <NumericDraftEnhancedInput
                committedDisplay={String(value)}
                draftResetKey={draftResetKey}
                onFiniteNumber={onFiniteNumber}
                inputMode="numeric"
                type="number"
                min={min}
                max={max}
                unit={unit}
                className="w-full min-w-0"
                selectAllOnFocus
            />
        </div>
    );
}

function ListSelectControl({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
}) {
    return (
        <div className="flex min-w-[8rem] flex-1 flex-col gap-1">
            <FieldLabel>{label}</FieldLabel>
            <Select
                value={value}
                options={options}
                onChange={next => onChange(String(next))}
                fullWidth
                portalMenu
            />
        </div>
    );
}

function listPaddingsUniform(current: ListWidgetProps): boolean {
    return (
        current.contentPaddingTop === current.contentPaddingRight &&
        current.contentPaddingTop === current.contentPaddingBottom &&
        current.contentPaddingTop === current.contentPaddingLeft
    );
}

function ListContentPaddingEditor({
    current,
    draftResetKey,
    onPatch,
}: {
    current: ListWidgetProps;
    draftResetKey: string;
    onPatch: (partial: Partial<ListWidgetProps>) => void;
}) {
    const [sidesOpen, setSidesOpen] = useState(false);
    const [popoverPos, setPopoverPos] = useState({ left: 0, top: 0, width: 280 });
    const anchorRef = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        setSidesOpen(false);
    }, [draftResetKey]);

    const patchPadding = useCallback(
        (partial: Partial<ListWidgetProps>) => {
            onPatch(partial);
        },
        [onPatch],
    );

    const uniform = listPaddingsUniform(current);
    const uniformDisplay = uniform ? String(current.contentPaddingTop) : "";
    const uniformPlaceholder = uniform ? undefined : "-";

    const setUniformPadding = useCallback(
        (value: number) => {
            const next = clampListSpacingPx(value);
            patchPadding({
                contentPaddingTop: next,
                contentPaddingRight: next,
                contentPaddingBottom: next,
                contentPaddingLeft: next,
            });
        },
        [patchPadding],
    );

    const setSidePadding = useCallback(
        (
            key:
                | "contentPaddingTop"
                | "contentPaddingRight"
                | "contentPaddingBottom"
                | "contentPaddingLeft",
            value: number,
        ) => {
            patchPadding({ [key]: clampListSpacingPx(value) });
        },
        [patchPadding],
    );

    const closeSides = useCallback(() => setSidesOpen(false), []);

    useLayoutEffect(() => {
        if (!sidesOpen || !anchorRef.current) {
            return;
        }

        const updatePosition = () => {
            const anchor = anchorRef.current;
            if (!anchor) {
                return;
            }
            const rect = anchor.getBoundingClientRect();
            const panelHeight = panelRef.current?.getBoundingClientRect().height ?? 140;
            const viewportPadding = 8;
            const width = Math.min(Math.max(rect.width, 260), window.innerWidth - viewportPadding * 2);
            let left = rect.left;
            let top = rect.bottom + 6;

            if (left + width > window.innerWidth - viewportPadding) {
                left = window.innerWidth - width - viewportPadding;
            }
            if (left < viewportPadding) {
                left = viewportPadding;
            }
            if (top + panelHeight > window.innerHeight - viewportPadding) {
                top = rect.top - panelHeight - 6;
            }
            if (top < viewportPadding) {
                top = viewportPadding;
            }

            setPopoverPos({ left, top, width });
        };

        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [sidesOpen]);

    useEffect(() => {
        if (!sidesOpen) {
            return;
        }

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) {
                return;
            }
            if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) {
                return;
            }
            closeSides();
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                closeSides();
            }
        };

        const timer = window.setTimeout(() => {
            document.addEventListener("mousedown", handlePointerDown, true);
        }, 0);
        document.addEventListener("keydown", handleKeyDown);

        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("mousedown", handlePointerDown, true);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [closeSides, sidesOpen]);

    const sides = [
        { key: "contentPaddingTop" as const, label: "Top" },
        { key: "contentPaddingRight" as const, label: "Right" },
        { key: "contentPaddingBottom" as const, label: "Bottom" },
        { key: "contentPaddingLeft" as const, label: "Left" },
    ];

    const popover =
        sidesOpen && typeof globalThis.document !== "undefined"
            ? createPortal(
                  <div
                      ref={panelRef}
                      role="dialog"
                      aria-label="Content padding per side"
                      className="fixed z-[70] rounded-lg border border-edge bg-[#17181c] p-3 shadow-2xl"
                      style={{
                          left: popoverPos.left,
                          top: popoverPos.top,
                          width: popoverPos.width,
                          maxWidth: "calc(100vw - 16px)",
                      }}
                      onMouseDown={event => event.stopPropagation()}
                  >
                      <p className="mb-2 text-xs font-medium text-fg-muted">Per side (px)</p>
                      <div className="grid grid-cols-2 gap-2 min-w-0">
                          {sides.map(({ key, label }) => (
                              <div key={key} className="flex min-w-0 flex-col gap-1">
                                  <span className="text-2xs font-medium text-fg-subtle">{label}</span>
                                  <NumericDraftEnhancedInput
                                      committedDisplay={String(current[key])}
                                      draftResetKey={`${draftResetKey}-pad-${key}`}
                                      onFiniteNumber={value => setSidePadding(key, value)}
                                      inputMode="numeric"
                                      type="number"
                                      min={0}
                                      max={LIST_SPACING_MAX_PX}
                                      unit="px"
                                      aria-label={`Content padding ${label}`}
                                      title={`Content padding ${label}`}
                                      className="w-full min-w-0"
                                      selectAllOnFocus
                                  />
                              </div>
                          ))}
                      </div>
                  </div>,
                  globalThis.document.body,
              )
            : null;

    return (
        <>
            <div ref={anchorRef} className="flex min-w-0 w-full flex-col gap-1 self-start">
                <FieldLabel>Content padding</FieldLabel>
                <div className="flex min-w-0 flex-nowrap items-stretch gap-2">
                    <div className="min-w-0 flex-1">
                        <NumericDraftEnhancedInput
                            committedDisplay={uniformDisplay}
                            draftResetKey={`${draftResetKey}-pad-u`}
                            onFiniteNumber={setUniformPadding}
                            inputMode="numeric"
                            type="number"
                            min={0}
                            max={LIST_SPACING_MAX_PX}
                            unit="px"
                            placeholder={uniformPlaceholder}
                            aria-label="Content padding on all sides"
                            title="Content padding on all sides"
                            className="w-full min-w-0"
                            selectAllOnFocus
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => setSidesOpen(open => !open)}
                        aria-expanded={sidesOpen}
                        aria-haspopup="dialog"
                        aria-label={sidesOpen ? "Close per-side content padding" : "Edit per-side content padding"}
                        className={controlButtonClass(sidesOpen)}
                        title="Per-side content padding"
                    >
                        {sidesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                </div>
            </div>
            {popover}
        </>
    );
}

function ScrollbarCustomizeField(props: CustomFieldProps<UIInspectorData>) {
    const { element, documentService, surfaceId } = props.data;
    const document = documentService.getDocument();
    const live = document.elements[element.id] ?? element;
    const listProps = getListProps(live);
    const hasAuthoredParts = Boolean(
        listProps.scrollbar.trackElementId &&
        listProps.scrollbar.thumbElementId &&
        document.elements[listProps.scrollbar.trackElementId] &&
        document.elements[listProps.scrollbar.thumbElementId],
    );

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
                ...scrollbarPartContainerProps(listProps.scrollbar.trackStyle),
            });

            const thumb = documentService.createElement(element.id, "nl.container", {
                x: 0,
                y: 0,
                width: listProps.scrollbar.thickness,
                height: listProps.scrollbar.minThumbLength,
            });
            documentService.updateElementExtra(thumb.id, { listSlot: "scrollbarThumb" });
            documentService.updateElementProps(thumb.id, {
                ...scrollbarPartContainerProps(listProps.scrollbar.thumbStyle),
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
            <Button
                type="button"
                variant="secondary"
                size="md"
                fullWidth
                className="h-9 min-h-[34px] px-3 text-xs"
                disabled={hasAuthoredParts}
                onClick={createParts}
            >
                {hasAuthoredParts ? "Scrollbar parts created" : "Customize scrollbar"}
            </Button>
            {hasAuthoredParts ? (
                <p className="text-2xs leading-snug text-fg-subtle">
                    Track and thumb are authored elements in the list outline. Select them to edit their appearance.
                </p>
            ) : (
                <p className="text-2xs leading-snug text-fg-subtle">
                    Creates authored track and thumb elements without changing the item template.
                </p>
            )}
        </div>
    );
}

function hasAuthoredScrollbarParts(data: UIInspectorData): boolean {
    const document = data.documentService.getDocument();
    const live = document.elements[data.element.id] ?? data.element;
    const listProps = getListProps(live);
    return Boolean(
        listProps.scrollbar.trackElementId &&
        listProps.scrollbar.thumbElementId &&
        document.elements[listProps.scrollbar.trackElementId] &&
        document.elements[listProps.scrollbar.thumbElementId],
    );
}

function ListToggleControl({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <button
            type="button"
            className="flex h-9 w-full items-center justify-between gap-3 rounded-lg border border-edge bg-transparent px-2.5 text-left text-xs font-medium text-fg transition hover:bg-fill-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-pressed={checked}
            onClick={() => onChange(!checked)}
        >
            <span className="min-w-0 truncate">{label}</span>
            <span
                className={`relative h-5 w-9 shrink-0 rounded-full border transition ${
                    checked ? "border-primary/60 bg-primary/30" : "border-edge bg-fill-subtle"
                }`}
                aria-hidden="true"
            >
                <span
                    className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-gray-100 shadow transition ${
                        checked ? "left-[17px]" : "left-0.5"
                    }`}
                />
            </span>
        </button>
    );
}

function ListLayoutField(props: CustomFieldProps<UIInspectorData>) {
    const current = getLiveListProps(props.data);
    const patch = (partial: Partial<ListWidgetProps>) => patchListProps(props.data, partial);
    const draftResetKey = props.data.element.id;

    return (
        <div className="space-y-2 min-w-0">
            <CompactModuleCard title="Flow">
                <div className="flex flex-wrap gap-2 min-w-0">
                    <ListSelectControl
                        label="Direction"
                        value={current.repeatDirection}
                        options={directionOptions}
                        onChange={value => patch({ repeatDirection: value as ListDirection })}
                    />
                    <ListNumberControl
                        label="Gap"
                        value={current.itemGap}
                        draftResetKey={`${draftResetKey}-item-gap`}
                        onFiniteNumber={value => patch({ itemGap: clampListSpacingPx(value, 128) })}
                        max={128}
                    />
                </div>
                <div className="mt-2">
                    <ListContentPaddingEditor
                        current={current}
                        draftResetKey={draftResetKey}
                        onPatch={patch}
                    />
                </div>
                <div className="mt-2">
                    <ListToggleControl
                        label="Drag content to scroll"
                        checked={current.dragContentScroll}
                        onChange={dragContentScroll => patch({ dragContentScroll })}
                    />
                </div>
            </CompactModuleCard>
        </div>
    );
}

function ListTemplateField(props: CustomFieldProps<UIInspectorData>) {
    const current = getLiveListProps(props.data);
    const patch = (partial: Partial<ListWidgetProps>) => patchListProps(props.data, partial);
    const draftResetKey = props.data.element.id;

    return (
        <div className="space-y-2 min-w-0">
            <CompactModuleCard title="Cell content">
                <div className="flex flex-wrap gap-2 min-w-0">
                    <ListSelectControl
                        label="Direction"
                        value={current.templateDirection}
                        options={directionOptions}
                        onChange={value => patch({ templateDirection: value as ListDirection })}
                    />
                    <ListNumberControl
                        label="Gap"
                        value={current.templateGap}
                        draftResetKey={`${draftResetKey}-template-gap`}
                        onFiniteNumber={value => patch({ templateGap: clampListSpacingPx(value, 128) })}
                        max={128}
                    />
                </div>
            </CompactModuleCard>
        </div>
    );
}

function ListScrollbarField(props: CustomFieldProps<UIInspectorData>) {
    const current = getLiveListProps(props.data);
    const scrollbar = current.scrollbar;
    const authored = hasAuthoredScrollbarParts(props.data);
    const patchScrollbar = (partial: Partial<UIListScrollbarProps>) => {
        patchListScrollbarProps(props.data, partial);
    };
    const draftResetKey = props.data.element.id;

    return (
        <div className="space-y-2 min-w-0">
            <CompactModuleCard title="Behavior">
                <ListToggleControl
                    label="Enabled"
                    checked={scrollbar.enabled}
                    onChange={enabled => patchScrollbar({ enabled })}
                />
                <div className="mt-2 flex flex-wrap gap-2 min-w-0">
                    <ListSelectControl
                        label="Side"
                        value={scrollbar.side}
                        options={scrollbarSideOptions}
                        onChange={value => patchScrollbar({ side: value as UIListScrollbarProps["side"] })}
                    />
                    <ListSelectControl
                        label="Visibility"
                        value={scrollbar.visibility}
                        options={scrollbarVisibilityOptions}
                        onChange={value => patchScrollbar({ visibility: value as UIListScrollbarProps["visibility"] })}
                    />
                </div>
            </CompactModuleCard>

            <CompactModuleCard title={authored ? "Content reserve" : "Default metrics"}>
                {authored ? (
                    <ListNumberControl
                        label="Inset"
                        value={scrollbar.contentInset}
                        draftResetKey={`${draftResetKey}-scrollbar-inset`}
                        onFiniteNumber={value => patchScrollbar({ contentInset: clampListSpacingPx(value, 64) })}
                        max={64}
                    />
                ) : (
                    <div className="flex flex-wrap gap-2 min-w-0">
                        <ListNumberControl
                            label="Thickness"
                            value={scrollbar.thickness}
                            draftResetKey={`${draftResetKey}-scrollbar-thickness`}
                            onFiniteNumber={value => patchScrollbar({ thickness: clampListMetricPx(value, 2, 64) })}
                            min={2}
                            max={64}
                        />
                        <ListNumberControl
                            label="Inset"
                            value={scrollbar.contentInset}
                            draftResetKey={`${draftResetKey}-scrollbar-inset`}
                            onFiniteNumber={value => patchScrollbar({ contentInset: clampListSpacingPx(value, 64) })}
                            max={64}
                        />
                        <ListNumberControl
                            label="Min thumb"
                            value={scrollbar.minThumbLength}
                            draftResetKey={`${draftResetKey}-scrollbar-min-thumb`}
                            onFiniteNumber={value => patchScrollbar({ minThumbLength: clampListMetricPx(value, 8, 256) })}
                            min={8}
                            max={256}
                        />
                    </div>
                )}
            </CompactModuleCard>
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
                        title: "Preview",
                        collapsible: true,
                        defaultCollapsed: false,
                        fields: [
                            defineField<D, any>({
                                id: "list.itemsBindingScope",
                                type: "select",
                                label: "Runtime items",
                                options: [
                                    { value: "none", label: "Preview only" },
                                    { value: "surfaceState", label: "Page state array" },
                                    { value: "globalState", label: "App state array" },
                                ],
                                getValue: (d: D) => getLiveListProps(d).itemsBinding?.kind ?? "none",
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
                                hidden: (d: D) => getLiveListProps(d).itemsBinding == null,
                                getValue: (d: D) => getLiveListProps(d).itemsBinding?.key ?? "",
                                setValue: (_d: D, v: string) => patchItemsBinding({ key: v }),
                            }),
                            defineField<D, any>({
                                id: "list.previewCount",
                                type: "inlineRow",
                                gap: 8,
                                wrap: false,
                                label: "Preview count",
                                items: [
                                    {
                                        id: "list.previewCountInput",
                                        className: "flex-1 min-w-0",
                                        render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                            const current = getLiveListProps(data);
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
                        title: "Layout",
                        fields: [
                            defineField<D, any>({
                                id: "list.layout.compact",
                                type: "custom",
                                component: ListLayoutField,
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.template",
                        type: "section",
                        title: "Item template",
                        fields: [
                            defineField<D, any>({
                                id: "list.template.compact",
                                type: "custom",
                                component: ListTemplateField,
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
                                id: "list.scrollbar.compact",
                                type: "custom",
                                component: ListScrollbarField,
                            }),
                            defineField<D, any>({
                                id: "list.scrollbar.trackColor",
                                type: "colorPicker",
                                label: "Track color",
                                displayMode: "icon-hex",
                                allowOpacity: false,
                                hidden: hasAuthoredScrollbarParts,
                                getValue: (d: D) => ({ hex: getLiveListProps(d).scrollbar.trackStyle.backgroundColor }),
                                setValue: (_d: D, value: ColorValue) => patchScrollbarPart("trackStyle", { backgroundColor: value.hex, fillType: "color", fillOpacity: 1 }),
                            }),
                            defineField<D, any>({
                                id: "list.scrollbar.trackImage",
                                type: "imageFill",
                                label: "Track image",
                                hidden: hasAuthoredScrollbarParts,
                                getValue: (d: D) => getLiveListProps(d).scrollbar.trackStyle.imageFill ?? undefined,
                                setValue: (_d: D, value: ImageFill) => patchScrollbarPart("trackStyle", { imageFill: value, fillType: "image" }),
                            }),
                            defineField<D, any>({
                                id: "list.scrollbar.thumbColor",
                                type: "colorPicker",
                                label: "Thumb color",
                                displayMode: "icon-hex",
                                allowOpacity: false,
                                hidden: hasAuthoredScrollbarParts,
                                getValue: (d: D) => ({ hex: getLiveListProps(d).scrollbar.thumbStyle.backgroundColor }),
                                setValue: (_d: D, value: ColorValue) => patchScrollbarPart("thumbStyle", { backgroundColor: value.hex, fillType: "color", fillOpacity: 1 }),
                            }),
                            defineField<D, any>({
                                id: "list.scrollbar.thumbImage",
                                type: "imageFill",
                                label: "Thumb image",
                                hidden: hasAuthoredScrollbarParts,
                                getValue: (d: D) => getLiveListProps(d).scrollbar.thumbStyle.imageFill ?? undefined,
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
