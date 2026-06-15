import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";

/** How children of `nl.container` participate in layout inside the editor surface. */
export type ContainerLayoutKind = "free" | "stack" | "scroll";

/**
 * Layout axis for `nl.container` (orthogonal to clipping):
 * - `absolute`: direct children use canvas `UILayout` x/y inside the container.
 * - `flow`: direct children are flex items; order comes from `childrenIds` (see `isUIElementFlowLayoutChild`).
 */
export type ContainerChildLayoutParticipation = "absolute" | "flow";

/** CSS overflow on the scroll viewport inner wrapper (single-axis scroll). */
export type ContainerScrollViewportOverflow = {
    overflowX: "hidden" | "auto";
    overflowY: "hidden" | "auto";
};

export type ContainerStackDirection = "horizontal" | "vertical";

export type ContainerStackAlignItems = "start" | "center" | "end" | "stretch";

export type ContainerStackJustifyContent =
    | "start"
    | "center"
    | "end"
    | "space-between"
    | "space-around";

/** Single-axis scroll: content scrolls along one axis; the other axis clips. */
export type ContainerScrollAxis = "x" | "y";

export type ContainerFillType = "color" | "image";

export type ContainerStrokeAlign = "none" | "center" | "inside" | "outside";

/** "all", one edge, or comma-separated edges (e.g. "bottom,left"). */
export type ContainerStrokeSide = string;

export type ContainerStrokeJoin = "miter" | "round" | "bevel";

/**
 * Serialized props for `nl.container`: chrome (rectangle-like) + layout mode + stack/scroll options.
 * Geometric `UILayout` stays on `UIElement.layout`; this object is only widget props.
 */
export type ContainerWidgetProps = {
    layoutKind: ContainerLayoutKind;

    stackDirection: ContainerStackDirection;
    stackGap: number;
    stackPaddingTop: number;
    stackPaddingRight: number;
    stackPaddingBottom: number;
    stackPaddingLeft: number;
    stackAlignItems: ContainerStackAlignItems;
    stackJustifyContent: ContainerStackJustifyContent;

    scrollAxis: ContainerScrollAxis;

    backgroundColor: string;
    borderRadius: number;
    borderRadiusTL: number;
    borderRadiusTR: number;
    borderRadiusBL: number;
    borderRadiusBR: number;
    borderRadiusLinked: boolean;
    borderColor: string;
    borderWidth: number;
    borderStyle: string;
    backgroundImage: string;
    backgroundFit: string;
    imageFill?: ImageFill | null;
    fillType: ContainerFillType;
    fillVisible: boolean;
    fillOpacity: number;
    strokeVisible: boolean;
    strokeOpacity: number;
    strokeAlign: ContainerStrokeAlign;
    strokeSide: ContainerStrokeSide;
    borderJoin: ContainerStrokeJoin;
    cornerAdvanced: boolean;
    /**
     * Clip child painting to the container's box (maps to `overflow: hidden` on the clipping layer).
     * Not a CSS overflow enum: it does not add `auto`/`scroll` axes. For `layoutKind: "scroll"`, the
     * scroll viewport still owns single-axis scrolling; this flag clips the outer chrome/content stack.
     */
    clipContent: boolean;

    transformOffsetX: number;
    transformOffsetY: number;
    transformScale: number;
    transformRotation: number;
    transformOpacity: number;

    /** Optional variant + conditional row chrome; when absent, flat props are the sole source. */
    appearance?: AppearanceModel | null;
};

export const defaultContainerWidgetProps: ContainerWidgetProps = {
    layoutKind: "free",

    stackDirection: "vertical",
    stackGap: 8,
    stackPaddingTop: 0,
    stackPaddingRight: 0,
    stackPaddingBottom: 0,
    stackPaddingLeft: 0,
    stackAlignItems: "stretch",
    stackJustifyContent: "start",

    scrollAxis: "y",

    backgroundColor: "#ffffff",
    borderRadius: 0,
    borderRadiusTL: 0,
    borderRadiusTR: 0,
    borderRadiusBL: 0,
    borderRadiusBR: 0,
    borderRadiusLinked: true,
    borderColor: "#000000",
    borderWidth: 1,
    borderStyle: "solid",
    backgroundImage: "",
    backgroundFit: "cover",
    imageFill: undefined,
    fillType: "color",
    fillVisible: true,
    fillOpacity: 1,
    strokeVisible: true,
    strokeOpacity: 1,
    strokeAlign: "center",
    strokeSide: "all",
    borderJoin: "miter",
    cornerAdvanced: false,
    clipContent: true,

    transformOffsetX: 0,
    transformOffsetY: 0,
    transformScale: 1,
    transformRotation: 0,
    transformOpacity: 1,
};

/** Symmetric editor clamp for stack gap and uniform stack padding (px). */
export const CONTAINER_STACK_SPACING_ABS_MAX_PX = 256;

export function clampContainerStackSpacingPx(v: number): number {
    if (!Number.isFinite(v)) {
        return 0;
    }
    return Math.max(-CONTAINER_STACK_SPACING_ABS_MAX_PX, Math.min(CONTAINER_STACK_SPACING_ABS_MAX_PX, v));
}

export function parseContainerLayoutKind(props: Record<string, unknown> | undefined): ContainerLayoutKind {
    const raw = props?.layoutKind;
    if (raw === "stack" || raw === "scroll" || raw === "free") {
        return raw;
    }
    return "free";
}

/** Map `layoutKind` to how direct children participate in layout (absolute vs flow). */
export function getContainerChildLayoutParticipation(kind: ContainerLayoutKind): ContainerChildLayoutParticipation {
    return kind === "free" ? "absolute" : "flow";
}

/** True when the container uses an inner scroll viewport (`ScrollInner`), independent of `clipContent`. */
export function containerLayoutUsesScrollViewport(kind: ContainerLayoutKind): boolean {
    return kind === "scroll";
}

/**
 * Normalize serialized `clipContent`. Only real booleans are accepted; anything else falls back to the
 * widget default so on-disk noise does not flip clipping unexpectedly.
 */
export function normalizeContainerClipContent(raw: unknown): boolean {
    if (typeof raw === "boolean") {
        return raw;
    }
    return defaultContainerWidgetProps.clipContent;
}

/**
 * Overflow for the scroll viewport: one axis scrolls, the other clips. This is part of `layoutKind: "scroll"`,
 * not a second overflow mode the author configures separately from `scrollAxis`.
 */
export function resolveContainerScrollViewportOverflow(axis: ContainerScrollAxis): ContainerScrollViewportOverflow {
    const isY = axis === "y";
    return {
        overflowX: isY ? "hidden" : "auto",
        overflowY: isY ? "auto" : "hidden",
    };
}

/** Host wrapper overflow for `layoutKind: "free"` (absolute children live on this host). */
export function resolveContainerFreeHostOverflow(clipContent: boolean): "hidden" | "visible" {
    return clipContent ? "hidden" : "visible";
}

type ContainerElementLike = { type: string; props?: Record<string, unknown> };

/** True when `nl.container` lays out direct children in flow (flex) rather than absolute canvas positions. */
export function isContainerFlowLayoutParent(element: ContainerElementLike): boolean {
    if (element.type !== "nl.container") {
        return false;
    }
    const k = parseContainerLayoutKind(element.props);
    return k === "stack" || k === "scroll";
}
