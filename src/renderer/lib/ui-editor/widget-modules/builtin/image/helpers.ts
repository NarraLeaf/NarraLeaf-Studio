import type { UIElement } from "@shared/types/ui-editor/document";
import { defaultImageWidgetProps, type ImageWidgetProps } from "./types";

export function getImageProps(element: UIElement): ImageWidgetProps {
    const p = element.props as Partial<ImageWidgetProps> | undefined;
    return {
        ...defaultImageWidgetProps,
        ...p,
    };
}
