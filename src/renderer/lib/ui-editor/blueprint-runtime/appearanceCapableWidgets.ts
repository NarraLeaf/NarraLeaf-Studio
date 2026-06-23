/**
 * Widget types that use shared appearance (variants + conditional rows).
 * Blueprint policy: only explicit variant switching is allowed for these types;
 * widgetProp merge and setVisible/setEnabled Host API calls are blocked until product relaxes this.
 */
export const UI_APPEARANCE_CAPABLE_ELEMENT_TYPES = ["nl.container", "nl.button", "nl.text"] as const;

export type UIAppearanceCapableElementType = (typeof UI_APPEARANCE_CAPABLE_ELEMENT_TYPES)[number];

const SET = new Set<string>(UI_APPEARANCE_CAPABLE_ELEMENT_TYPES);

export function isAppearanceCapableElementType(type: string): type is UIAppearanceCapableElementType {
    return SET.has(type);
}
