import type { UIElement } from "@shared/types/ui-editor/document";
import type { UITextRun } from "@shared/types/ui-editor/textRuns";
import { normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import { applyPlainTextToUITextRuns, normalizeUITextRuns } from "@shared/types/ui-editor/textRuns";
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
        // Normalised on the way out rather than trusted: a stored label may carry runs written by a
        // tool or by hand, including the arms and marks only a typed line can mean.
        rich: normalizeUITextRuns(p?.rich),
        effects,
    };
}

/**
 * The props patch that writes a label's text from a box that holds plain text.
 *
 * Both plain editors go through this one: the box in the inspector and the label typed on the
 * canvas. A plain box can only hand back a string, so the marks are carried across it - the stretch
 * that changed is written afresh, the rest of the paragraph keeps what it was set in. Leaving this
 * to each caller is how one of them ends up dropping every reading in a paragraph because one word
 * was corrected.
 */
export function textValuePatch(element: UIElement, nextText: string): { text: string; rich: UITextRun[] | undefined } {
    return {
        text: nextText,
        rich: applyPlainTextToUITextRuns(getTextProps(element).rich, nextText),
    };
}
