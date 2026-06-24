import type { UIElement } from "@shared/types/ui-editor/document";
import { normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import type {
    UIListItemsBinding,
    UIListScrollbarPartStyle,
    UIListScrollbarProps,
} from "@shared/types/ui-editor/list";
import {
    defaultListScrollbarPartStyle,
    defaultListScrollbarProps,
    defaultListWidgetProps,
    type ListDirection,
    type ListWidgetProps,
} from "./types";

export type ListItemContentAlignmentStyle = {
    justifyContent?: "flex-end";
    alignItems?: "flex-end";
};

export function resolveListItemContentAlignmentStyle(
    scrollbarOnLeft: boolean,
    templateDirection: ListDirection,
): ListItemContentAlignmentStyle {
    if (!scrollbarOnLeft) {
        return {};
    }
    return templateDirection === "horizontal"
        ? { justifyContent: "flex-end" }
        : { alignItems: "flex-end" };
}

function finiteNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
    const n = finiteNumber(value, fallback);
    return Math.max(min, Math.min(max, n));
}

function normalizeItemsBinding(value: unknown): UIListItemsBinding | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const raw = value as Partial<UIListItemsBinding>;
    const key = typeof raw.key === "string" ? raw.key.trim() : "";
    if (!key) {
        return null;
    }
    if (raw.kind === "surfaceState" || raw.kind === "globalState") {
        return { kind: raw.kind, key };
    }
    return null;
}

function normalizePartStyle(value: unknown, fallback: UIListScrollbarPartStyle): UIListScrollbarPartStyle {
    const raw = value && typeof value === "object" ? value as Partial<UIListScrollbarPartStyle> : {};
    return {
        ...defaultListScrollbarPartStyle,
        ...fallback,
        ...raw,
        backgroundColor:
            typeof raw.backgroundColor === "string" ? raw.backgroundColor : fallback.backgroundColor,
        fillType: raw.fillType === "image" ? "image" : raw.fillType === "color" ? "color" : fallback.fillType,
        backgroundImage:
            typeof raw.backgroundImage === "string" ? raw.backgroundImage : fallback.backgroundImage,
        backgroundFit:
            typeof raw.backgroundFit === "string" ? raw.backgroundFit : fallback.backgroundFit,
        fillOpacity: clampNumber(raw.fillOpacity, fallback.fillOpacity, 0, 1),
        borderRadius: clampNumber(raw.borderRadius, fallback.borderRadius, 0, 999),
        borderColor: typeof raw.borderColor === "string" ? raw.borderColor : fallback.borderColor,
        borderWidth: clampNumber(raw.borderWidth, fallback.borderWidth, 0, 64),
        borderStyle: typeof raw.borderStyle === "string" ? raw.borderStyle : fallback.borderStyle,
        imageFill: raw.imageFill === undefined ? fallback.imageFill : raw.imageFill,
    };
}

function normalizeScrollbar(value: unknown): UIListScrollbarProps {
    const raw = value && typeof value === "object" ? value as Partial<UIListScrollbarProps> : {};
    return {
        ...defaultListScrollbarProps,
        ...raw,
        enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaultListScrollbarProps.enabled,
        side:
            raw.side === "left" || raw.side === "right" || raw.side === "top" || raw.side === "bottom"
                ? raw.side
                : defaultListScrollbarProps.side,
        visibility:
            raw.visibility === "always" || raw.visibility === "hidden" || raw.visibility === "auto"
                ? raw.visibility
                : defaultListScrollbarProps.visibility,
        thickness: clampNumber(raw.thickness, defaultListScrollbarProps.thickness, 2, 64),
        contentInset: clampNumber(raw.contentInset, defaultListScrollbarProps.contentInset, 0, 64),
        minThumbLength: clampNumber(raw.minThumbLength, defaultListScrollbarProps.minThumbLength, 8, 256),
        trackStyle: normalizePartStyle(raw.trackStyle, defaultListScrollbarProps.trackStyle),
        thumbStyle: normalizePartStyle(raw.thumbStyle, defaultListScrollbarProps.thumbStyle),
        trackElementId: typeof raw.trackElementId === "string" && raw.trackElementId ? raw.trackElementId : null,
        thumbElementId: typeof raw.thumbElementId === "string" && raw.thumbElementId ? raw.thumbElementId : null,
    };
}

export function getListProps(element: UIElement): ListWidgetProps {
    const raw = (element.props ?? {}) as Partial<ListWidgetProps>;
    return {
        ...defaultListWidgetProps,
        ...raw,
        itemsBinding: normalizeItemsBinding(raw.itemsBinding),
        previewItems: Array.isArray(raw.previewItems) ? raw.previewItems : defaultListWidgetProps.previewItems,
        itemKeyPath: typeof raw.itemKeyPath === "string" ? raw.itemKeyPath : defaultListWidgetProps.itemKeyPath,
        previewCount: clampNumber(raw.previewCount, defaultListWidgetProps.previewCount, 1, 128),
        selectedIndex: clampNumber(raw.selectedIndex, defaultListWidgetProps.selectedIndex, -1, 127),
        itemGap: clampNumber(raw.itemGap, defaultListWidgetProps.itemGap, 0, 512),
        repeatDirection:
            raw.repeatDirection === "horizontal" || raw.repeatDirection === "vertical"
                ? raw.repeatDirection
                : defaultListWidgetProps.repeatDirection,
        contentPaddingTop: clampNumber(raw.contentPaddingTop, defaultListWidgetProps.contentPaddingTop, 0, 512),
        contentPaddingRight: clampNumber(raw.contentPaddingRight, defaultListWidgetProps.contentPaddingRight, 0, 512),
        contentPaddingBottom: clampNumber(raw.contentPaddingBottom, defaultListWidgetProps.contentPaddingBottom, 0, 512),
        contentPaddingLeft: clampNumber(raw.contentPaddingLeft, defaultListWidgetProps.contentPaddingLeft, 0, 512),
        templateDirection:
            raw.templateDirection === "horizontal" || raw.templateDirection === "vertical"
                ? raw.templateDirection
                : defaultListWidgetProps.templateDirection,
        templateGap: clampNumber(raw.templateGap, defaultListWidgetProps.templateGap, 0, 512),
        dragContentScroll:
            typeof raw.dragContentScroll === "boolean"
                ? raw.dragContentScroll
                : defaultListWidgetProps.dragContentScroll,
        scrollbar: normalizeScrollbar(raw.scrollbar),
        effects: normalizeElementEffectValues(raw.effects ?? defaultListWidgetProps.effects),
    };
}
