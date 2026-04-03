import type { UIElement } from "@shared/types/ui-editor/document";
import { defaultScrollWidgetProps, type ScrollWidgetProps } from "./types";

export function getScrollProps(element: UIElement): ScrollWidgetProps {
    const raw = (element.props ?? {}) as Partial<ScrollWidgetProps>;
    return { ...defaultScrollWidgetProps, ...raw };
}
