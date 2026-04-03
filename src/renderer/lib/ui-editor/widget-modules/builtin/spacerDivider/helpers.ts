import type { UIElement } from "@shared/types/ui-editor/document";
import { defaultSpacerDividerWidgetProps, type SpacerDividerWidgetProps } from "./types";

export function getSpacerDividerProps(element: UIElement): SpacerDividerWidgetProps {
    const raw = (element.props ?? {}) as Partial<SpacerDividerWidgetProps>;
    return { ...defaultSpacerDividerWidgetProps, ...raw };
}
