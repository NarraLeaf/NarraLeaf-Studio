import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";

/** How children of `nl.container` participate in layout inside the editor surface. */
export type ContainerLayoutKind = "free" | "stack" | "scroll";

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

export type ContainerStrokeSide = "all" | "top" | "right" | "bottom" | "left";

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
    clipContent: boolean;

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
};

export function parseContainerLayoutKind(props: Record<string, unknown> | undefined): ContainerLayoutKind {
    const raw = props?.layoutKind;
    if (raw === "stack" || raw === "scroll" || raw === "free") {
        return raw;
    }
    return "free";
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
