import type { ImageFill, ImageFillMode } from "@shared/types/ui-editor/imageFill";
import type { UIElement } from "@shared/types/ui-editor/document";
import { defaultImageWidgetProps, type ImageObjectFit, type ImageWidgetProps } from "./types";

/** Modes supported by nl.image (maps to CSS object-fit; no editor crop overlay). */
export const IMAGE_WIDGET_FILL_MODES: ImageFillMode[] = ["cover", "contain", "stretch"];

export function getImageProps(element: UIElement): ImageWidgetProps {
    const p = element.props as Partial<ImageWidgetProps> | undefined;
    return {
        ...defaultImageWidgetProps,
        ...p,
    };
}

function objectFitToFillMode(fit: ImageObjectFit): ImageFillMode {
    if (fit === "fill") {
        return "stretch";
    }
    return fit;
}

function fillModeToObjectFit(mode: ImageFillMode): ImageObjectFit {
    switch (mode) {
        case "stretch":
            return "fill";
        case "cover":
        case "contain":
            return mode;
        default:
            return "cover";
    }
}

/**
 * ImageFill for the shared ImageFillField (asset picker + mode), derived from nl.image props.
 */
export function imageWidgetPropsToImageFill(props: ImageWidgetProps): ImageFill {
    const mode = objectFitToFillMode(props.objectFit);
    const coercedMode = IMAGE_WIDGET_FILL_MODES.includes(mode) ? mode : "cover";
    return {
        mode: coercedMode,
        assetId: props.assetId?.trim() ? props.assetId : null,
    };
}

export function imageFillToImageWidgetPropsPatch(fill: ImageFill): Partial<ImageWidgetProps> {
    return {
        assetId: fill.assetId?.trim() ? fill.assetId : "",
        objectFit: fillModeToObjectFit(fill.mode),
    };
}
