/**
 * Boolean toggle the player flips.
 *
 * As with the slider and the text input, `props.checked` is only the state the *author* set as a
 * starting point - what the player flips lives in `WidgetRuntimeStateStore` for the session and is
 * never written back to the document. See `resolveSwitchRuntimeValue`.
 *
 * The on/off *looks* are not modelled here: both child parts carry an appearance variant with the
 * fixed id `UI_SWITCH_ON_VARIANT_ID`, and the renderer only flips the parts to it while checked.
 * That is why this table has no `thumbInset`, no `transitionMs` / `transitionEasing` and no
 * `orientation` - the travel is the `on` variant's `transformOffsetX`, the transition is that
 * field's own transition, and a rotated switch is `transformRotation`. Storing any of them here
 * too would be one number in two places.
 */

export type UISwitchChildSlot = "track" | "thumb";

export type UISwitchElementExtra = {
    switchSlot?: UISwitchChildSlot;
    runtimeVariantOverrideId?: string;
};

export type UISwitchWidgetProps = {
    /** The author's starting state. What the player toggles lives in WidgetRuntimeStateStore. */
    checked: boolean;
    /** Blocks pointer and keyboard toggling. Looks are the `disabled` appearance signal's job. */
    interactionDisabled: boolean;
    trackElementId?: string | null;
    thumbElementId?: string | null;
};

export type UISwitchRuntimeValue = { checked: boolean };

export const UI_SWITCH_ELEMENT_TYPE = "nl.switch";

/** Stable appearance variant id the switch flips its parts to while checked. */
export const UI_SWITCH_ON_VARIANT_ID = "on";

export const defaultSwitchWidgetProps: UISwitchWidgetProps = {
    checked: false,
    interactionDisabled: false,
    trackElementId: null,
    thumbElementId: null,
};

export function getUISwitchChildSlot(extra: Record<string, unknown> | undefined): UISwitchChildSlot | null {
    const slot = extra?.switchSlot;
    return slot === "track" || slot === "thumb" ? slot : null;
}

export function normalizeSwitchProps(raw: Record<string, unknown> | undefined): UISwitchWidgetProps {
    return {
        // Strict `=== true`: a stored string, number or missing key is off, never truthy-on.
        checked: raw?.checked === true,
        interactionDisabled: raw?.interactionDisabled === true,
        trackElementId: typeof raw?.trackElementId === "string" ? raw.trackElementId : null,
        thumbElementId: typeof raw?.thumbElementId === "string" ? raw.thumbElementId : null,
    };
}

export function resolveSwitchRuntimeValue(raw: Record<string, unknown> | undefined): UISwitchRuntimeValue {
    return { checked: normalizeSwitchProps(raw).checked };
}
