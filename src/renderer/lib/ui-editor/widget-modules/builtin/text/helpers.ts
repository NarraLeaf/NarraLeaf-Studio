import type { UIElement } from "@shared/types/ui-editor/document";
import { normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import { defaultTextWidgetProps, type TextWidgetProps } from "./types";

export function getTextProps(element: UIElement): TextWidgetProps {
    const p = element.props as Partial<TextWidgetProps> | undefined;
    const base = normalizeElementEffectValues(p?.effects ?? defaultTextWidgetProps.effects);
    let effects = { ...base };
    if (!effects.effectTextShadow && effects.effectShadow) {
        effects = { ...effects, effectTextShadow: effects.effectShadow };
    } else if (!effects.effectTextShadow && effects.effectGlow) {
        effects = { ...effects, effectTextShadow: effects.effectGlow };
    }
    // Text uses CSS text-shadow only; box-shadow effect fields are for chrome widgets.
    effects = {
        ...effects,
        effectShadow: null,
        effectInnerShadow: null,
        effectGlow: null,
    };
    return {
        ...defaultTextWidgetProps,
        ...p,
        fontAssetId: p?.fontAssetId ?? defaultTextWidgetProps.fontAssetId,
        effects,
    };
}
