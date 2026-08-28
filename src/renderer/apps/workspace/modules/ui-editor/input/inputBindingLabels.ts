import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import { formatBlueprintKeyboardBinding } from "@shared/types/blueprint/graph";
import {
    inputBindingDevices,
    type UIInputBinding,
    type UIInputPointerGesture,
} from "@shared/types/ui-editor/inputAction";

export type TranslateFn = (key: TranslationKey, params?: InterpolationParams) => string;

/**
 * What to call one binding, and which device to offer it under.
 *
 * Both halves of the input model show the same chips - the library panel where an action's bindings
 * are set, and the interface's own Input section - so the words come from one place.
 *
 * A key is shown through `formatBlueprintKeyboardBinding` rather than raw, so an author who bound
 * "esc" reads "Escape" here and on the `On Key Down` head that answers the same key.
 *
 * Comments in English per project convention.
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
 * **Four, where the model has three.** The model's `pointer` is every device that aims at a point -
 * a mouse, a trackpad, a pen - which is the right grouping for routing and the wrong one for a
 * picker: it put a sideways scroll in a row called Mouse, and no mouse scrolls sideways. So the
 * panels split it, and the split is theirs alone. Nothing is stored per display device and nothing
 * routes by one.
 */
export const INPUT_BINDING_DEVICES = ["mouse", "trackpad", "touch", "key"] as const;

export type InputBindingDevice = (typeof INPUT_BINDING_DEVICES)[number];

export function getInputDeviceLabel(device: InputBindingDevice, t: TranslateFn): string {
    return t(`uiEditor.inputActions.device.${device}`);
}

/** One row of a device's submenu: the gesture it adds, under the name that device does it by. */
export type InputDeviceGestureOffer = {
    gesture: UIInputPointerGesture;
    labelKey: TranslationKey;
};

/**
 * What each device offers, under the name that device produces it by.
 *
 * Two rules shaped this table, and both are worth stating because the obvious version of it is
 * wrong in a way nobody notices until a player complains.
 *
 * **A device only offers what it can do, and only where it is the one that does it.** A trackpad
 * clicks exactly as a mouse does, so it offers no click - that would be a second door to the same
 * room. What it offers is the pair no mouse has. Adding a binding from any row adds the same
 * binding, so a mouse with a tilt wheel still triggers a sideways scroll it was never offered.
 *
 * **A slide is named for the finger, and the finger goes the other way.** The gesture names where
 * the *viewport* goes: content follows the finger, so a finger sliding down carries the content
 * down and the viewport up, which is `wheelUp`. Sideways is the same inversion - sliding right is
 * `wheelLeft`. This table is the one place that reversal is written down. Every label read from it
 * is correct for the device it sits under, and an author never meets the underlying name.
 *
 * The trackpad rows say slide for a further reason: which way the fingers travel to produce a given
 * scroll is the operating system's to decide (macOS natural scrolling, Windows reverse scrolling
 * direction), so these labels follow the shipped default on both rather than claiming a law.
 */
export const INPUT_DEVICE_GESTURE_OFFERS: Record<InputBindingDevice, readonly InputDeviceGestureOffer[]> = {
    mouse: [
        { gesture: "click", labelKey: "uiEditor.inputActions.menu.mouseClick" },
        { gesture: "doubleClick", labelKey: "uiEditor.inputActions.menu.mouseDoubleClick" },
        { gesture: "rightClick", labelKey: "uiEditor.inputActions.menu.mouseRightClick" },
        { gesture: "middleClick", labelKey: "uiEditor.inputActions.menu.mouseMiddleClick" },
        { gesture: "wheelUp", labelKey: "uiEditor.inputActions.menu.mouseWheelUp" },
        { gesture: "wheelDown", labelKey: "uiEditor.inputActions.menu.mouseWheelDown" },
    ],
    trackpad: [
        { gesture: "wheelRight", labelKey: "uiEditor.inputActions.menu.trackpadSlideLeft" },
        { gesture: "wheelLeft", labelKey: "uiEditor.inputActions.menu.trackpadSlideRight" },
    ],
    touch: [
        { gesture: "click", labelKey: "uiEditor.inputActions.menu.touchTap" },
        { gesture: "longPress", labelKey: "uiEditor.inputActions.menu.touchLongPress" },
        { gesture: "wheelUp", labelKey: "uiEditor.inputActions.menu.touchSlideDown" },
        { gesture: "wheelDown", labelKey: "uiEditor.inputActions.menu.touchSlideUp" },
        { gesture: "wheelRight", labelKey: "uiEditor.inputActions.menu.touchSlideLeft" },
        { gesture: "wheelLeft", labelKey: "uiEditor.inputActions.menu.touchSlideRight" },
    ],
    key: [],
};

/**
 * Which devices can trigger one binding, in the panels' order.
 *
 * Read from what the devices can do, not from what the menu offers: a trackpad is not offered a
 * click and can still produce one, and a chip that omitted it would tell an author their action
 * does not work on half the machines it works on.
 */
const GESTURE_CAPABLE_DEVICES: Record<UIInputPointerGesture, readonly InputBindingDevice[]> = {
    click: ["mouse", "trackpad", "touch"],
    doubleClick: ["mouse", "trackpad"],
    rightClick: ["mouse", "trackpad"],
    middleClick: ["mouse"],
    wheelUp: ["mouse", "trackpad", "touch"],
    wheelDown: ["mouse", "trackpad", "touch"],
    wheelLeft: ["trackpad", "touch"],
    wheelRight: ["trackpad", "touch"],
    longPress: ["touch"],
};

export function getInputBindingDevices(binding: UIInputBinding): InputBindingDevice[] {
    if (binding.kind === "key") {
        return ["key"];
    }
    const capable = GESTURE_CAPABLE_DEVICES[binding.gesture];
    return INPUT_BINDING_DEVICES.filter(device => capable.includes(device));
}

/** The device names one binding is marked with, one per line. */
export function getInputBindingDevicesLabel(binding: UIInputBinding, t: TranslateFn): string {
    return getInputBindingDevices(binding)
        .map(device => getInputDeviceLabel(device, t))
        .join("\n");
}

/**
 * What one binding is called on each device that can trigger it, one per line.
 *
 * A chip carries one name - the scroll the app receives - and this is the rest of the answer: what
 * the player actually does, on each machine it works on. Shown on hover rather than in the panel,
 * because it answers a question an author has once per binding and never again.
 */
export function getInputBindingDeviceActs(binding: UIInputBinding, t: TranslateFn): string {
    if (binding.kind === "key") {
        return getInputDeviceLabel("key", t);
    }
    const lines: string[] = [];
    for (const device of getInputBindingDevices(binding)) {
        const offer = INPUT_DEVICE_GESTURE_OFFERS[device].find(entry => entry.gesture === binding.gesture);
        const act = offer ? t(offer.labelKey) : getInputPointerGestureLabel(binding.gesture, t);
        lines.push(`${getInputDeviceLabel(device, t)} ${act}`);
    }
    return lines.join("\n");
}

/**
 * The devices the routing model says reach a binding.
 *
 * The display split has no meaning below these panels, so anything comparing a binding against a
 * player's real device goes through the model rather than through {@link getInputBindingDevices}.
 */
export function getInputBindingRoutingDevices(binding: UIInputBinding): ReadonlySet<string> {
    return inputBindingDevices(binding) as ReadonlySet<string>;
}
