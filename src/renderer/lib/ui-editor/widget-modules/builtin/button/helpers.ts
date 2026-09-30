import type { UIElement } from "@shared/types/ui-editor/document";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import { normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import { normalizeUITextRuns } from "@shared/types/ui-editor/textRuns";
import {
    plainTextEditPatch,
    type MarkedLabelProps,
} from "@/lib/ui-editor/widget-modules/shared/text/markedLabel";
import { defaultButtonWidgetProps, type ButtonWidgetProps } from "./types";

export function getButtonProps(element: UIElement): ButtonWidgetProps {
    const p = element.props as Partial<ButtonWidgetProps> | undefined;
    return {
        ...defaultButtonWidgetProps,
        ...p,
        // Normalised on the way out rather than trusted, as a text label's are: a stored button may
        // carry runs written by a tool or by hand, including arms and marks only a typed line can mean.
        rich: normalizeUITextRuns(p?.rich),
        effects: normalizeElementEffectValues(p?.effects ?? defaultButtonWidgetProps.effects),
    };
}

/** A button keeps its string in `label` and its runs beside it in `rich`. */
export const BUTTON_MARKED_LABEL: MarkedLabelProps = {
    read: element => {
        const props = getButtonProps(element);
        return { text: props.label, rich: props.rich, color: props.color };
    },
    write: (label, rich) => ({ label, rich }),
};

/** The props patch that writes a button's label from a box that holds plain text; see `textValuePatch`. */
export function buttonLabelPatch(element: UIElement, nextLabel: string): Record<string, unknown> {
    return plainTextEditPatch(BUTTON_MARKED_LABEL, element, nextLabel);
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
        gradientFill: p.gradientFill,
        fillType: p.fillType,
        fillVisible: p.fillVisible,
        fillOpacity: p.fillOpacity,
        strokeVisible: p.borderStyle !== "none" && p.borderWidth > 0,
        strokeOpacity: 1,
        strokeAlign: "center",
        strokeSide: "all",
        borderJoin: "miter",
        cornerAdvanced: false,
        transformOffsetX: p.transformOffsetX,
        transformOffsetY: p.transformOffsetY,
        transformScale: p.transformScale,
        transformRotation: p.transformRotation,
        transformOpacity: p.transformOpacity,
        effects: { ...p.effects },
    };
}
