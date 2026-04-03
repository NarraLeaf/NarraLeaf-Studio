import type { UIElement } from "@shared/types/ui-editor/document";
import { defaultButtonWidgetProps, type ButtonWidgetProps } from "./types";

export function getButtonProps(element: UIElement): ButtonWidgetProps {
    const p = element.props as Partial<ButtonWidgetProps> | undefined;
    return {
        ...defaultButtonWidgetProps,
        ...p,
    };
}
