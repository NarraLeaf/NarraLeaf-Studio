import type { UIElement } from "@shared/types/ui-editor/document";
import { normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import {
    clampTextInputValue,
    defaultTextInputWidgetProps,
    normalizeTextInputProps,
    type UITextInputWidgetProps,
} from "@shared/types/ui-editor/textInput";
import { defaultButtonWidgetProps, type ButtonWidgetProps } from "../button/types";

/**
 * Element props for `nl.textInput`: the shared field contract plus the button's chrome and
 * typography prop names.
 *
 * The names are not a coincidence — the widget reuses the `kind: "button"` appearance model, and
 * `CompactButtonAppearance` / `resolveButtonVisualProps` read the flat baseline through
 * `getButtonProps(element)`. Renaming any chrome prop here silently detaches the appearance panel.
 * The button's own text props (`label`, its localization pair, vertical align, wrap) are omitted:
 * a single-line field has one line of text and its player-facing string is the runtime value.
 */
export type TextInputWidgetProps = UITextInputWidgetProps &
    Omit<
        ButtonWidgetProps,
        "label" | "localizable" | "localizationKey" | "textVerticalAlign" | "textWrapMode"
    >;

export const defaultTextInputElementProps: TextInputWidgetProps = {
    ...defaultTextInputWidgetProps,

    fontSize: 16,
    color: "#e5e7eb",
    fontWeight: "normal",
    lineHeight: 1.4,
    fontAssetId: null,

    backgroundColor: "#1f2937",
    fillType: "color",
    fillOpacity: 1,
    fillVisible: true,
    imageFill: undefined,
    backgroundImage: "",
    backgroundFit: "cover",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#4b5563",
    borderStyle: "solid",
    paddingX: 10,
    paddingY: 6,
    clipContent: true,
    cursor: "auto",

    transformOffsetX: 0,
    transformOffsetY: 0,
    transformScale: 1,
    transformRotation: 0,
    transformOpacity: 1,

    effects: { ...defaultButtonWidgetProps.effects },
};

export function getTextInputProps(element: UIElement): TextInputWidgetProps {
    const raw = (element.props ?? {}) as Partial<TextInputWidgetProps>;
    return {
        ...defaultTextInputElementProps,
        ...raw,
        // Normalized last: the shared contract owns clamping (value vs. max length, input mode, align).
        ...normalizeTextInputProps(element.props),
        effects: normalizeElementEffectValues(raw.effects ?? defaultTextInputElementProps.effects),
    };
}

/**
 * Bare prop patch for `UIDocumentService.updateElementProps`, which already merges.
 * Spreading the element's other props back in would let a stale inspector closure resurrect
 * sibling values that changed in between, so only the touched keys are returned — plus a
 * re-clamped `value` when either side of the value/max-length pair moves.
 */
export function patchTextInputProps(
    element: UIElement,
    partial: Partial<TextInputWidgetProps>,
): Record<string, unknown> {
    const next: Record<string, unknown> = { ...partial };
    if ("value" in partial || "maxLength" in partial) {
        const current = getTextInputProps(element);
        next.value = clampTextInputValue(
            partial.value ?? current.value,
            partial.maxLength ?? current.maxLength,
        );
    }
    return next;
}

/**
 * Widen text-input props to the `ButtonWidgetProps` shape the shared button appearance helpers
 * (`createInitialButtonAppearance`, `ensureButtonAppearanceHasAllKeys`) are typed against.
 * Only the chrome keys in `BUTTON_KEY_ORDER` are ever read from the result.
 */
export function textInputButtonBaselineProps(p: TextInputWidgetProps): ButtonWidgetProps {
    return {
        ...defaultButtonWidgetProps,
        ...p,
        label: "",
    };
}
