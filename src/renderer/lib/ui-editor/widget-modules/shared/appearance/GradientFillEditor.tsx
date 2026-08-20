import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
    DndContext,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    SortableContext,
    arrayMove,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { GripVertical, Plus, Trash2, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { Select } from "@/lib/components/elements/Select";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { useEscapeToClose } from "@/lib/components/elements/Modal";
import { useWindowOverlayHost } from "@/lib/components/layout";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import {
    colorValueToCss,
    parseColorValue,
    serializeColorValue,
} from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import { useBrandPaletteRevision } from "@/lib/ui-editor/runtime/useBrandPaletteRevision";
import {
    DEFAULT_GRADIENT_ANGLE,
    DEFAULT_GRADIENT_CENTER,
    DEFAULT_GRADIENT_FILL,
    DEFAULT_GRADIENT_RADIUS,
    type GradientFill,
    type GradientKind,
    type GradientStop,
} from "@shared/types/ui-editor/gradientFill";
import { gradientToCss } from "@shared/ui-editor/gradientCss";
import type { TranslationKey } from "@shared/i18n";

/**
 * The authoring surface for a gradient fill: a swatch that paints the gradient itself, and the
 * panel behind it.
 *
 * **What it offers is exactly what the model can store.** Three kinds, a stop list, and the two or
 * three numbers each kind needs - no free start/end handles, no rotated ellipse, no repeat. Those
 * are not missing controls, they are shapes CSS cannot express from numbers alone (they would need
 * the widget's pixel size in the render path), so offering them here would author a document the
 * painter could not honour.
 *
 * **A stop's colour goes through the ordinary colour picker.** That is the whole reason a stop
 * stores a colour *string*: an author points a stop at `nlbrand:primary` exactly as they would any
 * other colour field, and the delete confirmation and the `brand/broken-link` lint rule already
 * count it - they walk every string in the document rather than a whitelist of props.
 */

/**
 * The panel's own width, which is also why its numeric fields opt out of `popoverWhenNarrow`.
 *
 * That fallback exists for inspector columns whose width the field cannot know; here the width is
 * this constant. Left on, every field in the panel would swap itself for a button that opens yet
 * another popover - two clicks to type a number, and a trigger carrying no accessible name, since
 * the label the caller passes rides on the input inside the popover rather than on the button.
 */
const PANEL_WIDTH = 300;
const PANEL_SPACING = 8;
const PANEL_MARGIN = 8;
/** White is what an unreadable stored colour has always shown elsewhere (see `parseColorValue`). */
const STOP_COLOR_FALLBACK: ColorValue = { hex: "#ffffff", alpha: 1 };

const KIND_OPTIONS: { value: GradientKind; labelKey: TranslationKey }[] = [
    { value: "linear", labelKey: "widgetAppearance.gradient.kindLinear" },
    { value: "radial", labelKey: "widgetAppearance.gradient.kindRadial" },
    { value: "conic", labelKey: "widgetAppearance.gradient.kindConic" },
];

function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** A 0..1 stored number as the percentage the author types, at most two decimals. */
function toPercentDisplay(value: number): string {
    return String(Math.round(clamp01(value) * 10000) / 100);
}

function fromPercent(value: number): number {
    return clamp01(value / 100);
}

/**
 * Stops in paint order.
 *
 * The list on screen is the list CSS walks, so it is sorted here for the same reason
 * `normalizeGradientFill` sorts what it reads from disk: an author dragging a stop past its
 * neighbour should see the row move, not see the swatch change under a row that stayed put.
 */
function sortStops(stops: readonly GradientStop[]): GradientStop[] {
    return [...stops].sort((a, b) => a.offset - b.offset);
}

/**
 * A new stop in the widest gap, taking the colour of the stop before it.
 *
 * The widest gap because that is where there is room to see the new handle, and the neighbour's
 * colour because a stop that starts out invisible reads as "the button did nothing" - the author
 * then picks a colour and watches it appear, which is the order the rest of Studio works in.
 */
function withAddedStop(fill: GradientFill): GradientFill {
    const stops = sortStops(fill.stops);
    let insertAfter = 0;
    let widest = -1;
    for (let index = 0; index < stops.length - 1; index += 1) {
        const gap = stops[index + 1].offset - stops[index].offset;
        if (gap > widest) {
            widest = gap;
            insertAfter = index;
        }
    }
    const before = stops[insertAfter];
    const after = stops[insertAfter + 1] ?? before;
    const inserted: GradientStop = {
        offset: clamp01((before.offset + after.offset) / 2),
        color: before.color,
    };
    return { ...fill, stops: [...stops.slice(0, insertAfter + 1), inserted, ...stops.slice(insertAfter + 1)] };
}

/**
 * Move a stop to another place in the list by trading offsets, not array slots.
 *
 * Reordering the array alone would not survive a round trip through disk - `normalizeGradientFill`
 * sorts by offset on read, so the rows would spring back. The offsets are the positions on the ramp
 * and they stay put; what moves is which stop sits on each of them. For a move past one neighbour
 * that is exactly a trade of the two offsets, and for a longer drag it is the same idea applied to
 * every stop the dragged one passed. Either way the array comes back sorted, so the rows on screen
 * keep matching the stops CSS paints.
 */
function withReorderedStop(fill: GradientFill, from: number, to: number): GradientFill {
    const stops = sortStops(fill.stops);
    if (from < 0 || to < 0 || from >= stops.length || to >= stops.length || from === to) {
        return fill;
    }
    const offsets = stops.map((stop) => stop.offset);
    return {
        ...fill,
        stops: arrayMove(stops, from, to).map((stop, index) => ({ ...stop, offset: offsets[index] })),
    };
}

/**
 * The sortable id of a stop row.
 *
 * Positional rather than an id carried by the stop, because a stop has none: the model stores an
 * offset and a colour, and the list is re-sorted on every read. That is sound here only because the
 * list cannot change shape mid-drag - the same panel owns the add and remove buttons.
 */
function stopDragId(index: number): string {
    return `gradient-stop-${index}`;
}

type GradientStopRowProps = {
    stop: GradientStop;
    index: number;
    count: number;
    draftResetKey: string;
    onColorChange: (next: ColorValue) => void;
    onOffsetChange: (nextPercent: number) => void;
    /** Put this stop at `to`, an index in the sorted list. */
    onReorder: (to: number) => void;
    onRemove: () => void;
};

/**
 * One stop: its colour, its position, the handle that reorders it, and the bin.
 *
 * **The handle is a handle, not a spinner.** A caret pair used to sit here, immediately right of a
 * percentage field, where on every other numeric control in Studio a caret means "add one" - authors
 * read it as a stepper for the number next to it. The grip says "move this row" and nothing else,
 * and it is the same affordance the layer outline already uses.
 *
 * **Dragging goes through dnd-kit, which is pointer-based**, so the `.nl-drag-source` opt-in does not
 * enter into it: that class only revives the native HTML5 `draggable` attribute, which the global
 * `-webkit-user-drag: none` otherwise kills.
 */
function GradientStopRow({
    stop,
    index,
    count,
    draftResetKey,
    onColorChange,
    onOffsetChange,
    onReorder,
    onRemove,
}: GradientStopRowProps) {
    const { t } = useTranslation();
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: stopDragId(index),
    });
    const ordinal = index + 1;

    // Vertical only - the panel is one column wide, so lateral drift would just carry the row out
    // from under the cursor (the same reason the sidebar rail drops dnd-kit's x and its scale).
    const style: CSSProperties = {
        transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
        transition,
        zIndex: isDragging ? 1 : undefined,
        opacity: isDragging ? 0.6 : undefined,
    };

    return (
        <div ref={setNodeRef} style={style} className="flex items-center gap-1">
            <ColorPickerTrigger
                value={parseColorValue(stop.color, STOP_COLOR_FALLBACK)}
                displayMode="icon"
                brandPalette
                ariaLabel={t("widgetAppearance.gradient.stopColorAria", { index: ordinal })}
                onChange={onColorChange}
            />
            <NumericDraftEnhancedInput
                committedDisplay={toPercentDisplay(stop.offset)}
                draftResetKey={`${draftResetKey}-gradient-stop-${index}`}
                onFiniteNumber={onOffsetChange}
                aria-label={t("widgetAppearance.gradient.stopOffsetAria", { index: ordinal })}
                popoverWhenNarrow={false}
                inputMode="decimal"
                unit="%"
                min={0}
                max={100}
                className="w-full min-w-0"
            />
            <ToolbarButton
                size="xs"
                className="cursor-grab touch-none active:cursor-grabbing"
                {...attributes}
                {...listeners}
                aria-label={t("widgetAppearance.gradient.stopReorderAria", { index: ordinal })}
                data-tip={t("widgetAppearance.gradient.stopReorderHint")}
                // The carets this replaced were buttons, so the keyboard could reorder; a handle that
                // only answered the pointer would have quietly taken that away. The arrow keys move
                // the stop one place, and the spread above is deliberately first so this wins.
                onKeyDown={(event) => {
                    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
                    const to = index + delta;
                    if (delta === 0 || to < 0 || to >= count) {
                        return;
                    }
                    event.preventDefault();
                    onReorder(to);
                }}
            >
                <GripVertical className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
                size="xs"
                // Two stops is the floor the model and CSS agree on, so the last removal is refused
                // in the control rather than repaired behind the author's back.
                disabled={count <= 2}
                onClick={onRemove}
                aria-label={t("widgetAppearance.gradient.stopRemoveAria", { index: ordinal })}
                data-tip={count <= 2 ? t("widgetAppearance.gradient.stopRemoveFloor") : undefined}
            >
                <Trash2 className="h-3.5 w-3.5" />
            </ToolbarButton>
        </div>
    );
}

export type GradientFillEditorProps = {
    /** The stored gradient, or nothing yet - the default gradient stands in for an absent one. */
    value: GradientFill | undefined | null;
    onChange: (next: GradientFill) => void;
    /** Clears in-progress numeric drafts when the edited element changes. */
    draftResetKey: string;
    className?: string;
};

/**
 * The gradient as one `background-image` value, with brand-linked stops resolved as the palette
 * stands right now.
 *
 * **`useBrandPaletteRevision` is load-bearing, not decoration.** A palette edit is not a document
 * edit: `fill` is the same object it was, so a memo keyed on it alone keeps painting yesterday's
 * colours until something unrelated re-renders this component - which is why the defect reads as
 * "switching tabs fixes it".
 */
export function useGradientCss(fill: GradientFill): string {
    const brandRevision = useBrandPaletteRevision();
    return useMemo(
        () =>
            gradientToCss(
                fill,
                fill.stops.map((stop) => ({
                    offset: stop.offset,
                    color: colorValueToCss(parseColorValue(stop.color, STOP_COLOR_FALLBACK)),
                })),
            ),
        [brandRevision, fill],
    );
}

/** The swatch, and the panel it opens. */
export function GradientFillEditor({ value, onChange, draftResetKey, className }: GradientFillEditorProps) {
    const { t } = useTranslation();
    const overlayHost = useWindowOverlayHost();
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);

    const fill = value ?? DEFAULT_GRADIENT_FILL;
    const stops = useMemo(() => sortStops(fill.stops), [fill.stops]);
    const css = useGradientCss(fill);

    const close = useCallback(() => setOpen(false), []);
    useEscapeToClose(open, close);

    const handlePosition = useCallback(() => {
        const trigger = triggerRef.current;
        if (!trigger) {
            return;
        }
        const rect = trigger.getBoundingClientRect();
        const panelHeight = panelRef.current?.offsetHeight ?? 320;
        let left = Math.min(rect.left, window.innerWidth - PANEL_WIDTH - PANEL_MARGIN);
        let top = rect.bottom + PANEL_SPACING;
        if (left < PANEL_MARGIN) {
            left = PANEL_MARGIN;
        }
        if (top + panelHeight > window.innerHeight - PANEL_MARGIN) {
            top = Math.max(PANEL_MARGIN, rect.top - panelHeight - PANEL_SPACING);
        }
        setPosition({ left, top });
    }, []);

    useLayoutEffect(() => {
        if (!open) {
            return;
        }
        handlePosition();
        const reposition = () => handlePosition();
        window.addEventListener("resize", reposition);
        window.addEventListener("scroll", reposition, true);
        return () => {
            window.removeEventListener("resize", reposition);
            window.removeEventListener("scroll", reposition, true);
        };
    }, [handlePosition, open]);

    const patch = useCallback((next: GradientFill) => onChange(next), [onChange]);

    // 4px before a drag starts, the same threshold the layer outline uses, so a click that lands on
    // the handle and wobbles is still a click.
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
    const stopDragIds = useMemo(() => stops.map((_, index) => stopDragId(index)), [stops]);
    const handleStopDragEnd = useCallback(
        (event: DragEndEvent) => {
            const from = stopDragIds.indexOf(String(event.active.id));
            const to = event.over ? stopDragIds.indexOf(String(event.over.id)) : -1;
            if (from === -1 || to === -1 || from === to) {
                return;
            }
            patch(withReorderedStop(fill, from, to));
        },
        [fill, patch, stopDragIds],
    );

    const angle = fill.angle ?? DEFAULT_GRADIENT_ANGLE;
    const center = fill.center ?? DEFAULT_GRADIENT_CENTER;
    const radius = fill.radius ?? DEFAULT_GRADIENT_RADIUS;
    const showAngle = fill.kind === "linear" || fill.kind === "conic";
    const showCenter = fill.kind === "radial" || fill.kind === "conic";
    const showRadius = fill.kind === "radial";

    const panel = open
        ? createPortal(
              <div
                  ref={panelRef}
                  role="dialog"
                  aria-label={t("widgetAppearance.gradient.title")}
                  className="fixed z-50 rounded-lg border border-edge-strong bg-surface-overlay p-3 text-fg shadow-2xl"
                  style={{ left: position.left, top: position.top, width: PANEL_WIDTH }}
                  onMouseDown={(event) => event.stopPropagation()}
              >
                  <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{t("widgetAppearance.gradient.title")}</span>
                      <ToolbarButton
                          size="xs"
                          onClick={close}
                          aria-label={t("widgetAppearance.gradient.closeAria")}
                      >
                          <X className="h-3.5 w-3.5" />
                      </ToolbarButton>
                  </div>

                  <div
                      role="img"
                      aria-label={t("widgetAppearance.gradient.previewAria")}
                      className="h-10 w-full rounded-md border border-edge"
                      style={{ backgroundImage: css }}
                  />

                  <div className="mt-3">
                      <FieldLabel as="div">{t("widgetAppearance.gradient.kind")}</FieldLabel>
                      <Select
                          value={fill.kind}
                          options={KIND_OPTIONS.map((option) => ({ value: option.value, labelKey: option.labelKey }))}
                          fullWidth
                          size="sm"
                          ariaLabel={t("widgetAppearance.gradient.kind")}
                          onChange={(next) => patch({ ...fill, kind: String(next) as GradientKind })}
                      />
                  </div>

                  {showAngle ? (
                      <div className="mt-3">
                          <FieldLabel as="div">{t("widgetAppearance.gradient.angle")}</FieldLabel>
                          <NumericDraftEnhancedInput
                              committedDisplay={String(Math.round(angle * 100) / 100)}
                              draftResetKey={`${draftResetKey}-gradient-angle`}
                              onFiniteNumber={(next) => patch({ ...fill, angle: next })}
                              aria-label={t("widgetAppearance.gradient.angle")}
                              popoverWhenNarrow={false}
                              inputMode="decimal"
                              unit="°"
                              className="w-full min-w-0"
                          />
                      </div>
                  ) : null}

                  {showCenter ? (
                      <div className="mt-3">
                          <FieldLabel as="div">{t("widgetAppearance.gradient.center")}</FieldLabel>
                          <div className="grid grid-cols-2 gap-2">
                              <NumericDraftEnhancedInput
                                  committedDisplay={toPercentDisplay(center.x)}
                                  draftResetKey={`${draftResetKey}-gradient-center-x`}
                                  onFiniteNumber={(next) =>
                                      patch({ ...fill, center: { x: fromPercent(next), y: center.y } })
                                  }
                                  aria-label={t("widgetAppearance.gradient.centerXAria")}
                                  popoverWhenNarrow={false}
                                  inputMode="decimal"
                                  unit="%"
                                  min={0}
                                  max={100}
                                  className="w-full min-w-0"
                              />
                              <NumericDraftEnhancedInput
                                  committedDisplay={toPercentDisplay(center.y)}
                                  draftResetKey={`${draftResetKey}-gradient-center-y`}
                                  onFiniteNumber={(next) =>
                                      patch({ ...fill, center: { x: center.x, y: fromPercent(next) } })
                                  }
                                  aria-label={t("widgetAppearance.gradient.centerYAria")}
                                  popoverWhenNarrow={false}
                                  inputMode="decimal"
                                  unit="%"
                                  min={0}
                                  max={100}
                                  className="w-full min-w-0"
                              />
                          </div>
                      </div>
                  ) : null}

                  {showRadius ? (
                      <div className="mt-3">
                          <FieldLabel as="div">{t("widgetAppearance.gradient.radius")}</FieldLabel>
                          <div className="grid grid-cols-2 gap-2">
                              <NumericDraftEnhancedInput
                                  committedDisplay={toPercentDisplay(radius.x)}
                                  draftResetKey={`${draftResetKey}-gradient-radius-x`}
                                  onFiniteNumber={(next) =>
                                      patch({ ...fill, radius: { x: fromPercent(next), y: radius.y } })
                                  }
                                  aria-label={t("widgetAppearance.gradient.radiusXAria")}
                                  popoverWhenNarrow={false}
                                  inputMode="decimal"
                                  unit="%"
                                  min={0}
                                  max={100}
                                  className="w-full min-w-0"
                              />
                              <NumericDraftEnhancedInput
                                  committedDisplay={toPercentDisplay(radius.y)}
                                  draftResetKey={`${draftResetKey}-gradient-radius-y`}
                                  onFiniteNumber={(next) =>
                                      patch({ ...fill, radius: { x: radius.x, y: fromPercent(next) } })
                                  }
                                  aria-label={t("widgetAppearance.gradient.radiusYAria")}
                                  popoverWhenNarrow={false}
                                  inputMode="decimal"
                                  unit="%"
                                  min={0}
                                  max={100}
                                  className="w-full min-w-0"
                              />
                          </div>
                      </div>
                  ) : null}

                  <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between">
                          <FieldLabel as="div" className="mb-0">
                              {t("widgetAppearance.gradient.stops")}
                          </FieldLabel>
                          <ToolbarButton
                              size="xs"
                              onClick={() => patch(withAddedStop(fill))}
                              aria-label={t("widgetAppearance.gradient.addStopAria")}
                              data-tip={t("widgetAppearance.gradient.addStopAria")}
                          >
                              <Plus className="h-3.5 w-3.5" />
                          </ToolbarButton>
                      </div>
                      <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={handleStopDragEnd}
                          // The default instructions describe dnd-kit's own space-bar lift, which
                          // this list does not have: only a pointer sensor is registered, and the
                          // keyboard path is the handle's own arrow keys.
                          accessibility={{
                              screenReaderInstructions: {
                                  draggable: t("widgetAppearance.gradient.stopReorderHint"),
                              },
                          }}
                      >
                          <SortableContext items={stopDragIds} strategy={verticalListSortingStrategy}>
                              <div className="space-y-1">
                                  {stops.map((stop, index) => (
                                      <GradientStopRow
                                          key={stopDragId(index)}
                                          stop={stop}
                                          index={index}
                                          count={stops.length}
                                          draftResetKey={draftResetKey}
                                          onColorChange={(next) =>
                                              patch({
                                                  ...fill,
                                                  stops: stops.map((existing, i) =>
                                                      i === index
                                                          ? { ...existing, color: serializeColorValue(next) }
                                                          : existing,
                                                  ),
                                              })
                                          }
                                          onOffsetChange={(next) =>
                                              patch({
                                                  ...fill,
                                                  stops: sortStops(
                                                      stops.map((existing, i) =>
                                                          i === index
                                                              ? { ...existing, offset: fromPercent(next) }
                                                              : existing,
                                                      ),
                                                  ),
                                              })
                                          }
                                          onReorder={(to) => patch(withReorderedStop(fill, index, to))}
                                          onRemove={() =>
                                              patch({ ...fill, stops: stops.filter((_, i) => i !== index) })
                                          }
                                      />
                                  ))}
                              </div>
                          </SortableContext>
                      </DndContext>
                  </div>
              </div>,
              overlayHost,
          )
        : null;

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                aria-label={t("widgetAppearance.gradient.openEditorAria")}
                aria-expanded={open}
                data-tip={t("widgetAppearance.gradient.openEditorAria")}
                className={cn(
                    "h-9 w-9 shrink-0 cursor-default rounded-md border border-edge bg-transparent transition",
                    "hover:border-edge-strong focus:outline-none",
                    className,
                )}
                style={{ backgroundImage: css }}
            />
            {panel}
        </>
    );
}
