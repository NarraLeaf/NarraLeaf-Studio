import type { UIElement } from "@shared/types/ui-editor/document";
import { normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import { defaultTextWidgetProps, type TextWidgetProps } from "./types";

export function getTextProps(element: UIElement): TextWidgetProps {
    const p = element.props as Partial<TextWidgetProps> | undefined;
    return {
        ...defaultTextWidgetProps,
        ...p,
        fontAssetId: p?.fontAssetId ?? defaultTextWidgetProps.fontAssetId,
        effects: normalizeElementEffectValues(p?.effects ?? defaultTextWidgetProps.effects),
    };
}
