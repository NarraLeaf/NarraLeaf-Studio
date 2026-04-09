import type { UIElement } from "@shared/types/ui-editor/document";
import { normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import { defaultListWidgetProps, type ListWidgetProps } from "./types";

export function getListProps(element: UIElement): ListWidgetProps {
    const raw = (element.props ?? {}) as Partial<ListWidgetProps>;
    return {
        ...defaultListWidgetProps,
        ...raw,
        effects: normalizeElementEffectValues(raw.effects ?? defaultListWidgetProps.effects),
    };
}
