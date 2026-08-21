import type { UIElement } from "@shared/types/ui-editor/document";
import { normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import { normalizeVerticalTypography } from "@/lib/ui-editor/widget-modules/shared/text/verticalTypography";
import { defaultTextWidgetProps, type TextWidgetProps } from "./types";

/**
 * What a text specialisation answers where the element itself is silent.
 *
 * A default declared here holds for every element of that type, including the ones already on disk:
 * the dialogue line scales itself to its box unless the author says otherwise, and every project
 * built before the setting existed reads as scaling rather than as opted out.
 */
const TEXT_TYPE_DEFAULTS: Readonly<Record<string, Partial<TextWidgetProps>>> = {
    "nl.dialog.sentence": { textAutoFit: true },
};

export function getTextProps(element: UIElement): TextWidgetProps {
    const p = element.props as Partial<TextWidgetProps> | undefined;
    const typeDefaults = TEXT_TYPE_DEFAULTS[element.type] ?? {};
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
        ...typeDefaults,
        ...p,
        ...normalizeVerticalTypography(p),
        fontAssetId: p?.fontAssetId ?? defaultTextWidgetProps.fontAssetId,
        effects,
    };
}
