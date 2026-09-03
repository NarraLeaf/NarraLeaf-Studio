import type { CSSProperties } from "react";
import type { UIElement } from "@shared/types/ui-editor/document";
import { normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import type {
    UIListItemsBinding,
    UIListScrollbarPartStyle,
    UIListScrollbarProps,
} from "@shared/types/ui-editor/list";
import { isUIListItemsBindingKind } from "@shared/types/ui-editor/list";
import { normalizeGradientFill } from "@shared/types/ui-editor/gradientFill";
import {
    isDefaultUIPageAnimationSettings,
    normalizeUIPageAnimationSettings,
    type UIPageAnimationSettings,
} from "@shared/types/ui-editor/pageAnimation";
import {
    isPhysicallyHorizontalAxis,
    normalizeVerticalTypography,
    type TextWritingMode,
} from "@/lib/ui-editor/widget-modules/shared/text/verticalTypography";
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

/** What the item flow is, once the writing mode and the wrap have been read against each other. */
export type ListRepeatLayout = {
    /**
     * Whether the axis the content grows and scrolls along is the screen's horizontal one.
     *
     * Everything physical reads this rather than working it out again: which overflow scrolls, and
     * which way a drag pans.
     */
    overflowIsHorizontal: boolean;
    /** The flex host that repeats the item template, sized so the wrap can happen. */
    flexHostStyle: CSSProperties;
};

/**
 * How a list lays its items out: the flow, and the axis that overflows.
 *
 * One function, because those two answers must not be allowed to disagree. `repeatDirection` names
 * a flex axis rather than a screen axis and flex axes turn with the writing mode, and wrapping
 * moves the axis the content grows along to the other one - items stop at the edge of the box
 * instead of running past it, and it is the stack of lines that gets longer.
 */
export function resolveListRepeatLayout(
    props: Pick<ListWidgetProps, "repeatDirection" | "repeatWrap" | "writingMode" | "itemGap">,
): ListRepeatLayout {
    const repeatIsHorizontal = isPhysicallyHorizontalAxis(props.repeatDirection, props.writingMode);
    const mainIsBlockAxis = props.repeatDirection === "vertical";
    // Sized logically rather than in width/height: which screen axis a wrap has to break against is
    // the flex main axis, and that follows `repeatDirection` through the writing mode. A block box
    // already fills the inline axis, so only a main axis that is the block axis needs stating; the
    // cross axis is the one that grows, and keeps the "at least fill the box" it has without wrap.
    const wrapSizing: CSSProperties = mainIsBlockAxis
        ? { blockSize: "100%", minInlineSize: "100%" }
        : { minBlockSize: "100%" };
    return {
        overflowIsHorizontal: props.repeatWrap ? !repeatIsHorizontal : repeatIsHorizontal,
        flexHostStyle: {
            display: "flex",
            flexDirection: mainIsBlockAxis ? "column" : "row",
            gap: props.itemGap,
            alignItems: "stretch",
            ...(props.repeatWrap
                ? {
                      flexWrap: "wrap",
                      // Not an authored choice: the initial value spreads the lines over the whole
                      // cross axis, which would put two lines at opposite ends of the box instead
                      // of one under the other at `itemGap`.
                      alignContent: "flex-start",
                      ...wrapSizing,
                  }
                : {
                      // The cross axis is the one the items do not run along, so it is the one that fills.
                      minWidth: repeatIsHorizontal ? 0 : "100%",
                      minHeight: repeatIsHorizontal ? "100%" : 0,
                  }),
        },
    };
}

function finiteNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
    const n = finiteNumber(value, fallback);
    return Math.max(min, Math.min(max, n));
}

/**
 * A binding keeps its source with no key yet: picking a source and naming it are two separate
 * moves in the inspector, and collapsing the half-made binding to nothing put the source dropdown
 * back on "Preview only" the instant it was changed, so the key field never appeared and no list
 * could be bound at all. An unnamed binding reads nothing, which is what leaves the list on its
 * preview items until the key is typed.
 */
function normalizeItemsBinding(value: unknown): UIListItemsBinding | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const raw = value as Partial<UIListItemsBinding>;
    if (!isUIListItemsBindingKind(raw.kind)) {
        return null;
    }
    return { kind: raw.kind, key: typeof raw.key === "string" ? raw.key.trim() : "" };
}

/** The three readers a list items binding can point at. Hosts supply whichever they have. */
export type ListItemsBindingSources = {
    surfaceState?: { get(key: string): unknown } | null;
    globalState?: { get(key: string): unknown } | null;
    /** Props the current page was opened with; absent for hosts that never open pages with props. */
    pageProps?: Readonly<Record<string, unknown>> | null;
};

/**
 * Read the array a list's items binding points at.
 *
 * Every host resolves the binding through here so the sources cannot drift apart. A missing key and
 * a value that is not an array both read as unbound, which is what leaves the list on its preview
 * items rather than showing an empty list the author never authored.
 */
export function resolveListItemsBindingArray(
    binding: UIListItemsBinding | null | undefined,
    sources: ListItemsBindingSources,
): unknown[] | null {
    if (!binding || !binding.key) {
        return null;
    }
    let value: unknown;
    if (binding.kind === "globalState") {
        value = sources.globalState?.get(binding.key);
    } else if (binding.kind === "pageProp") {
        const props = sources.pageProps;
        value = props && Object.prototype.hasOwnProperty.call(props, binding.key)
            ? props[binding.key]
            : undefined;
    } else {
        value = sources.surfaceState?.get(binding.key);
    }
    return Array.isArray(value) ? value : null;
}

const SCROLLBAR_FILL_TYPES: readonly UIListScrollbarPartStyle["fillType"][] = ["color", "image", "gradient"];

/**
 * A stored fill kind this build understands, or the caller's fallback.
 *
 * Scrollbar part styles are a free-form bag on disk, so an unreadable value has to land somewhere;
 * keeping the fallback rather than forcing `"color"` means a track that was authored as an image
 * does not silently become a flat colour because one neighbouring field was unreadable. Extend the
 * list when a fill kind is added - an omission here is a silent downgrade, not a type error.
 */
function coerceScrollbarFillType(
    raw: unknown,
    fallback: UIListScrollbarPartStyle["fillType"],
): UIListScrollbarPartStyle["fillType"] {
    return typeof raw === "string" && SCROLLBAR_FILL_TYPES.includes(raw as UIListScrollbarPartStyle["fillType"])
        ? (raw as UIListScrollbarPartStyle["fillType"])
        : fallback;
}

function normalizePartStyle(value: unknown, fallback: UIListScrollbarPartStyle): UIListScrollbarPartStyle {
    const raw = value && typeof value === "object" ? value as Partial<UIListScrollbarPartStyle> : {};
    return {
        ...defaultListScrollbarPartStyle,
        ...fallback,
        ...raw,
        backgroundColor:
            typeof raw.backgroundColor === "string" ? raw.backgroundColor : fallback.backgroundColor,
        fillType: coerceScrollbarFillType(raw.fillType, fallback.fillType),
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
        gradientFill:
            raw.gradientFill === undefined ? fallback.gradientFill : normalizeGradientFill(raw.gradientFill),
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

/**
 * A stored row animation, or null when the list was never given one.
 *
 * Null and "all defaults" are the same thing to the renderer - nothing moves - so an untouched list
 * keeps no record at all, exactly as an element without an animation does.
 */
function normalizeListItemAnimation(value: unknown): UIPageAnimationSettings | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const settings = normalizeUIPageAnimationSettings(value);
    return isDefaultUIPageAnimationSettings(settings) ? null : settings;
}

export function getListProps(element: UIElement): ListWidgetProps {
    const raw = (element.props ?? {}) as Partial<ListWidgetProps>;
    return {
        ...defaultListWidgetProps,
        ...raw,
        itemsBinding: normalizeItemsBinding(raw.itemsBinding),
        itemStructId: typeof raw.itemStructId === "string" && raw.itemStructId.trim() ? raw.itemStructId.trim() : null,
        items: Array.isArray(raw.items) ? raw.items : defaultListWidgetProps.items,
        itemKeyFieldId:
            typeof raw.itemKeyFieldId === "string" && raw.itemKeyFieldId.trim() ? raw.itemKeyFieldId.trim() : null,
        placeholderCount: clampNumber(raw.placeholderCount, defaultListWidgetProps.placeholderCount, 1, 128),
        itemAnimation: normalizeListItemAnimation(raw.itemAnimation),
        selectedIndex: clampNumber(raw.selectedIndex, defaultListWidgetProps.selectedIndex, -1, 127),
        itemGap: clampNumber(raw.itemGap, defaultListWidgetProps.itemGap, 0, 512),
        repeatDirection:
            raw.repeatDirection === "horizontal" || raw.repeatDirection === "vertical"
                ? raw.repeatDirection
                : defaultListWidgetProps.repeatDirection,
        repeatWrap: typeof raw.repeatWrap === "boolean" ? raw.repeatWrap : defaultListWidgetProps.repeatWrap,
        writingMode: normalizeVerticalTypography(raw as { writingMode?: TextWritingMode }).writingMode,
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
