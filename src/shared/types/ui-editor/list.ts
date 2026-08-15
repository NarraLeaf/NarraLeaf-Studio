import type { ImageFill } from "./imageFill";
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
};

export type UIListScrollbarVisibility = "auto" | "always" | "hidden";
export type UIListScrollbarSide = "right" | "left" | "bottom" | "top";

export type UIListScrollbarPartStyle = {
    backgroundColor: string;
    fillType: "color" | "image";
    imageFill?: ImageFill | null;
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

