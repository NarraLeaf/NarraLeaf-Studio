import { isWidgetTypeOf } from "@shared/types/ui-editor/widgetInheritance";

/**
 * Widget types that use shared appearance (variants + conditional rows).
 * Blueprint policy: only explicit variant switching is allowed for these types;
 * widgetProp merge and setVisible/setEnabled Host API calls are blocked until product relaxes this.
 */
export const UI_APPEARANCE_CAPABLE_ELEMENT_TYPES = ["nl.container", "nl.button", "nl.text", "nl.image"] as const;

export type UIAppearanceCapableElementType = (typeof UI_APPEARANCE_CAPABLE_ELEMENT_TYPES)[number];

/**
 * Specialisations answer yes as well.
 *
 * A Dialog Sentence carries a text appearance model - its inspector authors variants on it - so
 * `setVariant` rejecting it by type was the one thing standing between a game UI author and the
 * variant they had already written. The `widgetProp` merge this also turns off for them was already
 * dead: the appearance resolver overlays the variant's rows over the flat props it merged into.
 */
export function isAppearanceCapableElementType(type: string): type is UIAppearanceCapableElementType {
    return UI_APPEARANCE_CAPABLE_ELEMENT_TYPES.some(capable => isWidgetTypeOf(type, capable));
}
