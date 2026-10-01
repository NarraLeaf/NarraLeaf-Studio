import type { UIElement } from "@shared/types/ui-editor/document";
import { normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import { normalizeUITextRuns } from "@shared/types/ui-editor/textRuns";
import { normalizeVerticalTypography } from "@/lib/ui-editor/widget-modules/shared/text/verticalTypography";
import {
    plainTextEditPatch,
    type MarkedLabelProps,
} from "@/lib/ui-editor/widget-modules/shared/text/markedLabel";
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
 * Where a text widget's words come from, as its inspector offers the choice.
 *
 * - `literal`: the element's own `text` (translated through its own unit when `localizable`).
 * - `key`: a named translation key; the game shows the key's text and never the element's own.
 * - `blueprint`: a Blueprint Value writes `text`.
 */
export type TextSource = "literal" | "key" | "blueprint";

/**
 * The source a stored text element is read from - derived, not stored.
 *
 * In the order the game resolves them: a key wins over everything (`useLocalizedWidgetText` reads
 * it before the text it was handed), so an element that also carries words of its own or a
 * Blueprint Value is a keyed one. `keysApply` is false while the project has no source language: a
 * build then carries no keys, and the game shows the element's own text.
 *
 * Null for a list template's text bound to a field of its row (and to no key), which is answered by
 * the row and offers none of the three.
 */
export function textSourceOf(element: UIElement, keysApply: boolean): TextSource | null {
    if (keysApply && getTextProps(element).localizationKey?.trim()) {
        return "key";
    }
    const binding = element.valueBindings?.text;
    if (binding?.kind === "listItemField") {
        return null;
    }
    if (binding?.kind === "blueprintValue") {
        return "blueprint";
    }
    return "literal";
}

/** A text label keeps its string in `text` and its runs beside it in `rich`. */
export const TEXT_MARKED_LABEL: MarkedLabelProps = {
    read: element => {
        const props = getTextProps(element);
        return { text: props.text, rich: props.rich, color: props.color };
    },
    write: (text, rich) => ({ text, rich }),
};

/**
 * The props patch that writes a label's text from a box that holds plain text.
 *
 * Both plain editors go through this one: the box in the inspector and the label typed on the
 * canvas. A plain box can only hand back a string, so the marks are carried across it - the stretch
 * that changed is written afresh, the rest of the paragraph keeps what it was set in.
 */
export function textValuePatch(element: UIElement, nextText: string): Record<string, unknown> {
    return plainTextEditPatch(TEXT_MARKED_LABEL, element, nextText);
}
