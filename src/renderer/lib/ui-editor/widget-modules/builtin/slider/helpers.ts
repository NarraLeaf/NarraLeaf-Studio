import type { UIElement } from "@shared/types/ui-editor/document";
import {
    defaultSliderWidgetProps,
    normalizeSliderProps,
    type UISliderWidgetProps,
} from "@shared/types/ui-editor/slider";

export function getSliderProps(element: UIElement): UISliderWidgetProps {
    return normalizeSliderProps({
        ...defaultSliderWidgetProps,
        ...(element.props ?? {}),
    });
}

export function patchSliderProps(element: UIElement, partial: Partial<UISliderWidgetProps>): Record<string, unknown> {
    const current = getSliderProps(element);
    return {
        ...(element.props ?? {}),
        ...current,
        ...partial,
    };
}
