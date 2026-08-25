import type { GradientFill } from "./gradientFill";
import type { ImageFill } from "./imageFill";
import type { UIStructDef } from "./struct";
import { isWidgetTypeOf, listWidgetTypesOf } from "./widgetInheritance";

/**
 * Widget types that reuse the `nl.list` item-template machinery: item template child slots,
 * per-item scope isolation, `listItemRefresh`, and runtime list items. The Game UI slot wrappers
 * (`nl.notification.list`, `nl.choice.list`, `nl.nvl.list`) receive their runtime items from the
 * NarraLeaf slot bridge instead of authored content.
 *
 * Derived from the widget inheritance table rather than listed again: those wrappers extend
 * `nl.list` there, and a fourth wrapper added to that table belongs in this list by definition.
 */
export const UI_LIST_LIKE_WIDGET_TYPES: readonly string[] = listWidgetTypesOf("nl.list");

export function isListLikeWidgetType(elementType: string | null | undefined): boolean {
    return isWidgetTypeOf(elementType, "nl.list");
}

export type UIListChildSlot = "itemTemplate" | "scrollbarTrack" | "scrollbarThumb";

export type UIListElementExtra = {
    listSlot?: UIListChildSlot;
    runtimeVariantOverrideId?: string;
};

/**
 * Where a list reads its runtime items from when no blueprint has written items into it.
 *
 * `pageProp` reads the props the current page was opened with, so an array handed to `Go Page`
 * arrives at the list without a blueprint copying it into state first.
 */
export type UIListItemsBinding =
    | { kind: "surfaceState"; key: string }
    | { kind: "globalState"; key: string }
    | { kind: "pageProp"; key: string };

export const UI_LIST_ITEMS_BINDING_KINDS = ["surfaceState", "globalState", "pageProp"] as const;

export function isUIListItemsBindingKind(value: unknown): value is UIListItemsBinding["kind"] {
    return typeof value === "string"
        && (UI_LIST_ITEMS_BINDING_KINDS as readonly string[]).includes(value);
}

export type UIListItemScope = {
    item: unknown;
    index: number;
    count: number;
    key: string;
    /**
     * Whether this is the selected row.
     *
     * On the scope because it belongs to the row rather than to any one widget in it: everything in
     * a selected row reads as selected, and each widget decides for itself whether it has an
     * appearance row that says so.
     */
    selected?: boolean;
    /**
     * The shape the owning list declared, carried rather than looked up.
     *
     * A field binding is resolved deep inside the element merge, which holds an element and a scope
     * and no document. Putting the struct on the scope keeps that read a read - the list already
     * resolved it once for its own columns and keys.
     */
    struct?: UIStructDef | null;
};

export type UIListScrollbarVisibility = "auto" | "always" | "hidden";
export type UIListScrollbarSide = "right" | "left" | "bottom" | "top";

export type UIListScrollbarPartStyle = {
    backgroundColor: string;
    fillType: "color" | "image" | "gradient";
    imageFill?: ImageFill | null;
    /** Sibling of `imageFill`, selected by `fillType: "gradient"`. */
    gradientFill?: GradientFill | null;
    backgroundImage: string;
    backgroundFit: string;
    fillOpacity: number;
    borderRadius: number;
    borderColor: string;
    borderWidth: number;
    borderStyle: string;
};

export type UIListScrollbarProps = {
    enabled: boolean;
    side: UIListScrollbarSide;
    visibility: UIListScrollbarVisibility;
    thickness: number;
    contentInset: number;
    minThumbLength: number;
    trackStyle: UIListScrollbarPartStyle;
    thumbStyle: UIListScrollbarPartStyle;
    trackElementId?: string | null;
    thumbElementId?: string | null;
};

export function getUIListChildSlot(extra: Record<string, unknown> | undefined): UIListChildSlot | null {
    const slot = extra?.listSlot;
    return slot === "itemTemplate" || slot === "scrollbarTrack" || slot === "scrollbarThumb" ? slot : null;
}

export function isUIListScrollbarSlot(slot: UIListChildSlot | null): boolean {
    return slot === "scrollbarTrack" || slot === "scrollbarThumb";
}

/**
 * What keys one rendered row apart from its siblings.
 *
 * Row state - hover, focus, the runtime variant, a blueprint variable record - is keyed by this, so
 * the format is not private to the renderer: whoever carries a row event onwards has to be able to
 * tell whose row it names, and a key that only the list could parse would silently hand one row's
 * state to whatever the event reached next.
 */
export function buildUIListItemInstanceKey(listElementId: string, itemKey: string): string {
    return `${UI_LIST_ITEM_INSTANCE_PREFIX}${listElementId}-${itemKey}`;
}

/** Whether an instance key names a row of this list, so an event leaving the list can shed it. */
export function isUIListItemInstanceKeyOf(instanceKey: string | undefined | null, listElementId: string): boolean {
    return Boolean(instanceKey) && String(instanceKey).startsWith(`${UI_LIST_ITEM_INSTANCE_PREFIX}${listElementId}-`);
}

const UI_LIST_ITEM_INSTANCE_PREFIX = "list-";

/** What a `Scroll` or `Scroll End` head reads off the list viewport. */
export type UIListScrollMetrics = {
    offset: number;
    maxOffset: number;
    progress: number;
};

/**
 * Where the list has got to along its scroll axis.
 *
 * `progress` is how far the end of the content has come, not how far the viewport has travelled.
 * Two consequences, both of which an author asking "are we at the bottom?" depends on:
 *
 * - Content that fits without scrolling has its last row already at or past the end of the list, so
 *   it reads 1. Reading 0 there described a list that is at the top and at the bottom at once as
 *   only the former - and that is exactly the list where the question has no other way to be
 *   answered, since a viewport that cannot scroll never fires a scroll event either.
 * - The last pixel of a scroll can land a hair short. `offset` is fractional while the sizes it is
 *   measured against are rounded, so a viewport that has gone as far as it can go reports, say,
 *   73.6 out of 74. That hair is still the end, so it reads 1 rather than 0.995. On a short list
 *   the shortfall is a whole percent of the range, which is enough to make a plain `progress >= x`
 *   test say no at the bottom of a list and yes at the bottom of a longer one.
 */
export function resolveUIListScrollMetrics(viewportSize: number, contentSize: number, offset: number): UIListScrollMetrics {
    const maxOffset = Math.max(0, contentSize - viewportSize);
    return {
        offset,
        maxOffset,
        progress: isAtUIListScrollEnd(offset, maxOffset) ? 1 : offset / maxOffset,
    };
}

/** Whether those metrics sit at the far end, within the rounding a fractional layout leaves behind. */
export function isUIListScrolledToEnd(metrics: UIListScrollMetrics): boolean {
    return isAtUIListScrollEnd(metrics.offset, metrics.maxOffset);
}

/** The one definition of "as far as this axis goes", so progress and Scroll End cannot disagree. */
function isAtUIListScrollEnd(offset: number, maxOffset: number): boolean {
    return maxOffset <= 0 || offset >= maxOffset - 1;
}
/** Whether those metrics sit at the near end. The mirror of {@link isUIListScrolledToEnd}. */
export function isUIListScrolledToStart(metrics: UIListScrollMetrics): boolean {
    return metrics.maxOffset <= 0 || metrics.offset <= 1;
}

/**
 * What a list reports before it has measured itself, and what one that never scrolls keeps reporting.
 *
 * At the start and at the end at once, which is what a viewport with nothing to scroll is.
 */
export const UI_LIST_SCROLL_METRICS_AT_REST: UIListScrollMetrics = Object.freeze({ offset: 0, maxOffset: 0, progress: 1 });

