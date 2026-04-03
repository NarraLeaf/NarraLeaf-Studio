import type { UIElement } from "@shared/types/ui-editor/document";
import { defaultStackWidgetProps, type StackWidgetProps } from "./types";

export function getStackProps(element: UIElement): StackWidgetProps {
    const raw = (element.props ?? {}) as Partial<StackWidgetProps>;
    return { ...defaultStackWidgetProps, ...raw };
}
