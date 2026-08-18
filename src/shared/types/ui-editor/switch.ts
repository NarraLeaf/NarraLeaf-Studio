/**
 * Boolean toggle the player flips.
 *
 * As with the slider and the text input, `props.checked` is only the state the *author* set as a
 * starting point - what the player flips lives in `WidgetRuntimeStateStore` for the session and is
 * never written back to the document. See `resolveSwitchRuntimeValue`.
 *
 * The on/off *looks* are not modelled here: both child parts carry an appearance variant with the
 * fixed id `UI_SWITCH_ON_VARIANT_ID`, and the renderer only flips the parts to it while checked.
 * That is why this table has no `thumbInset` and no `orientation`: the track's on colour is that
 * variant's, and a rotated switch is `transformRotation`.
 *
 * How far the thumb travels is not a look and is not stored here either. It is a state motion on the
 * switch itself (`props.stateMotions`, see `@shared/types/ui-editor/stateMotion`), because the thumb's
 * own geometry belongs to the thumb: an author who drags it is placing it, not describing a state.
 */

import type { UIStateMotionOffset } from "./stateMotion";

export type UISwitchChildSlot = "track" | "thumb";

export type UISwitchElementExtra = {
    switchSlot?: UISwitchChildSlot;
    runtimeVariantOverrideId?: string;
    /** Handed down by the switch for the state it is in; the part itself stores nothing about it. */
    stateMotionOffset?: UIStateMotionOffset;
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
