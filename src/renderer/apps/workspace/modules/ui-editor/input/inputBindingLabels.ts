import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import { formatBlueprintKeyboardBinding } from "@shared/types/blueprint/graph";
import {
    UI_INPUT_POINTER_GESTURES,
    inputBindingDevices,
    inputBindingReachesDevice,
    type UIInputBinding,
    type UIInputPointerGesture,
} from "@shared/types/ui-editor/inputAction";
import type { UIInputActionSource } from "@shared/types/ui-editor/inputActionEvent";

export type TranslateFn = (key: TranslationKey, params?: InterpolationParams) => string;

/**
 * What to call one binding.
 *
 * Both halves of the input model show the same chips - the library panel where the project's
 * defaults are set, and the interface's own Input section where a surface adds to them - so the
 * words come from one place, the way `getStageSlotLabel` keeps the five stage slots to one.
 *
 * A key is shown through `formatBlueprintKeyboardBinding` rather than raw, so an author who bound
 * "esc" reads "Escape" here and on the `On Key Down` head that answers the same key.
 */
export function getInputPointerGestureLabel(gesture: UIInputPointerGesture, t: TranslateFn): string {
    return t(`uiEditor.inputActions.gesture.${gesture}`);
}

export function getInputBindingLabel(binding: UIInputBinding, t: TranslateFn): string {
    return binding.kind === "pointer"
        ? getInputPointerGestureLabel(binding.gesture, t)
        : formatBlueprintKeyboardBinding(binding.key) || binding.key;
}

/**
 * The devices the author panels list bindings under, in the order they are listed.
 *
 * A subset of `UIInputActionSource` rather than the whole union. The union is what a fired action
 * reports, and it names one device no binding in this build can reach; a picker built from it would
 * offer a group with nothing that can go into it.
 */
export const INPUT_BINDING_DEVICES = ["pointer", "key", "touch"] as const satisfies readonly UIInputActionSource[];

export type InputBindingDevice = (typeof INPUT_BINDING_DEVICES)[number];

export function getInputDeviceLabel(device: InputBindingDevice, t: TranslateFn): string {
    return t(`uiEditor.inputActions.device.${device}`);
}

/**
 * Which devices reach one binding, in the panels' order.
 *
 * Several bindings answer to two: a click is a mouse button and a finger's tap, and the four scroll
 * directions are a wheel, a trackpad and a finger dragging a screen. So this is a list rather than
 * one device, and every marking drawn from it has room for more than one.
 */
export function getInputBindingDevices(binding: UIInputBinding): InputBindingDevice[] {
    const devices = inputBindingDevices(binding);
    return INPUT_BINDING_DEVICES.filter(device => devices.has(device));
}

/** The device names one binding is marked with, one per line. */
export function getInputBindingDevicesLabel(binding: UIInputBinding, t: TranslateFn): string {
    return getInputBindingDevices(binding)
        .map(device => getInputDeviceLabel(device, t))
        .join("\n");
}

/**
 * The gestures a player on this device can produce.
 *
 * Empty for the keyboard, which reaches no gesture: its group offers key capture instead. A gesture
 * two devices reach is returned for both, and the binding added from either group is the same one.
 */
export function getInputDeviceGestures(device: InputBindingDevice): UIInputPointerGesture[] {
    return UI_INPUT_POINTER_GESTURES.filter(gesture =>
        inputBindingReachesDevice({ kind: "pointer", gesture }, device),
    );
}
