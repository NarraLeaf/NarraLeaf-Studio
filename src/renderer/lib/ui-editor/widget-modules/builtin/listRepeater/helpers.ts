import type { UIElement } from "@shared/types/ui-editor/document";
import { defaultListRepeaterWidgetProps, type ListRepeaterWidgetProps } from "./types";

export function getListRepeaterProps(element: UIElement): ListRepeaterWidgetProps {
    const raw = (element.props ?? {}) as Partial<ListRepeaterWidgetProps>;
    return { ...defaultListRepeaterWidgetProps, ...raw };
}
