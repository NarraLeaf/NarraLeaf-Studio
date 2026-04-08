import type { UIElement } from "@shared/types/ui-editor/document";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import { defaultButtonWidgetProps, type ButtonWidgetProps } from "./types";

export function getButtonProps(element: UIElement): ButtonWidgetProps {
    const p = element.props as Partial<ButtonWidgetProps> | undefined;
    return {
        ...defaultButtonWidgetProps,
        ...p,
    };
}

/** Synthesize rectangle-like props for image-fill normalization in the appearance inspector. */
export function buttonPropsToImageFillBaseline(p: ButtonWidgetProps): RectangleLikeProps {
    const r = p.borderRadius;
    return {
        backgroundColor: p.backgroundColor,
        borderRadius: r,
        borderRadiusTL: r,
        borderRadiusTR: r,
        borderRadiusBL: r,
        borderRadiusBR: r,
        borderRadiusLinked: true,
        borderColor: p.borderColor,
        borderWidth: p.borderWidth,
        borderStyle: p.borderStyle,
        backgroundImage: p.backgroundImage,
        backgroundFit: p.backgroundFit,
        imageFill: p.imageFill,
        fillType: p.fillType,
        fillVisible: p.fillVisible,
        fillOpacity: p.fillOpacity,
        strokeVisible: p.borderStyle !== "none" && p.borderWidth > 0,
        strokeOpacity: 1,
        strokeAlign: "center",
        strokeSide: "all",
        borderJoin: "miter",
        cornerAdvanced: false,
    };
}
