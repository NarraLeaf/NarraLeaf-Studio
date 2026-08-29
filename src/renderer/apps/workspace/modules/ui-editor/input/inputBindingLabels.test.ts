import { describe, expect, it } from "vitest";
import { en } from "@shared/i18n/catalog/en";
import { flattenCatalog } from "@shared/i18n/flatten";
import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import {
    UI_INPUT_POINTER_GESTURES,
    inputBindingDevices,
} from "@shared/types/ui-editor/inputAction";
import {
    INPUT_BINDING_DEVICES,
    INPUT_DEVICE_GESTURE_OFFERS,
    getInputBindingDeviceActs,
    getInputBindingDevices,
    getInputBindingDevicesLabel,
    getInputDeviceLabel,
    getInputPointerGestureLabel,
} from "./inputBindingLabels";

/**
 * What the author panels say about which device does what.
 *
 * The panels split the model's `pointer` into a mouse and a trackpad, which is a display decision
 * and therefore one that can drift from the model without anything failing to compile. These are
 * the answers a panel would be lying about if it did: a gesture reachable in the model that no row
 * offers would be unbindable, and a row offering one the model cannot raise would be a control that
 * does nothing.
 *
 * Comments in English per project convention.
 */

/** Resolves a key to itself, so a test can assert which key a label came from. */
const echo = (key: TranslationKey, _params?: InterpolationParams) => key as string;

const catalogKeys = new Set(flattenCatalog(en).keys());

describe("input binding devices", () => {
    it("lists the devices of a binding in the panels' order", () => {
        expect(getInputBindingDevices({ kind: "pointer", gesture: "click" })).toEqual([
            "mouse",
            "trackpad",
            "touch",
        ]);
        expect(getInputBindingDevices({ kind: "pointer", gesture: "middleClick" })).toEqual(["mouse"]);
        expect(getInputBindingDevices({ kind: "pointer", gesture: "longPress" })).toEqual(["touch"]);
        expect(getInputBindingDevices({ kind: "key", key: "Escape" })).toEqual(["key"]);
    });

    it("does not claim a plain mouse scrolls sideways", () => {
        // The defect the split exists for: the model reaches both with `pointer`, and a row called
        // Mouse offering them was describing hardware most players do not have.
        expect(getInputBindingDevices({ kind: "pointer", gesture: "wheelLeft" })).toEqual(["trackpad", "touch"]);
        expect(getInputBindingDevices({ kind: "pointer", gesture: "wheelRight" })).toEqual(["trackpad", "touch"]);
    });

    it("marks every binding with at least one device", () => {
        for (const gesture of UI_INPUT_POINTER_GESTURES) {
            expect(getInputBindingDevices({ kind: "pointer", gesture })).not.toHaveLength(0);
        }
    });

    it("names each device on its own line", () => {
        expect(getInputBindingDevicesLabel({ kind: "pointer", gesture: "longPress" }, echo)).toBe(
            "uiEditor.inputActions.device.touch",
        );
    });

    it("names every device in the source catalogue", () => {
        for (const device of INPUT_BINDING_DEVICES) {
            expect(catalogKeys).toContain(`uiEditor.inputActions.device.${device}`);
        }
    });
});

describe("what each device offers", () => {
    it("offers every gesture under at least one device", () => {
        for (const gesture of UI_INPUT_POINTER_GESTURES) {
            const offered = INPUT_BINDING_DEVICES.some(device =>
                INPUT_DEVICE_GESTURE_OFFERS[device].some(offer => offer.gesture === gesture),
            );
            expect({ gesture, offered }).toEqual({ gesture, offered: true });
        }
    });

    it("offers nothing the model cannot raise from that device", () => {
        for (const device of INPUT_BINDING_DEVICES) {
            for (const offer of INPUT_DEVICE_GESTURE_OFFERS[device]) {
                // The panels' mouse and trackpad are both the model's `pointer`.
                const source = device === "touch" ? "touch" : "pointer";
                expect({ device, gesture: offer.gesture }).toEqual({
                    device,
                    gesture: inputBindingDevices({ kind: "pointer", gesture: offer.gesture }).has(source)
                        ? offer.gesture
                        : "unreachable",
                });
            }
        }
    });

    it("keeps the trackpad row to what no mouse can do", () => {
        expect(INPUT_DEVICE_GESTURE_OFFERS.trackpad.map(offer => offer.gesture)).toEqual([
            "wheelRight",
            "wheelLeft",
        ]);
    });

    it("names a slide for the finger, which travels against the scroll", () => {
        // The one reversal in the whole feature, and the one every table of it gets backwards:
        // content follows the finger, so sliding down carries the viewport up.
        const named = (key: string) =>
            INPUT_DEVICE_GESTURE_OFFERS.touch.find(offer => offer.labelKey.endsWith(key))?.gesture;
        expect(named("touchSlideDown")).toBe("wheelUp");
        expect(named("touchSlideUp")).toBe("wheelDown");
        expect(named("touchSlideRight")).toBe("wheelLeft");
        expect(named("touchSlideLeft")).toBe("wheelRight");
    });

    it("leaves the keyboard row to key capture", () => {
        expect(INPUT_DEVICE_GESTURE_OFFERS.key).toEqual([]);
    });

    it("names every offer and every gesture in the source catalogue", () => {
        for (const device of INPUT_BINDING_DEVICES) {
            for (const offer of INPUT_DEVICE_GESTURE_OFFERS[device]) {
                expect(catalogKeys).toContain(offer.labelKey);
            }
        }
        for (const gesture of UI_INPUT_POINTER_GESTURES) {
            expect(catalogKeys).toContain(getInputPointerGestureLabel(gesture, echo));
        }
        expect(getInputDeviceLabel("trackpad", echo)).toBe("uiEditor.inputActions.device.trackpad");
    });

    it("says what one binding is called on each machine it works on", () => {
        expect(getInputBindingDeviceActs({ kind: "pointer", gesture: "wheelUp" }, echo)).toBe(
            [
                "uiEditor.inputActions.device.mouse uiEditor.inputActions.menu.mouseWheelUp",
                "uiEditor.inputActions.device.trackpad uiEditor.inputActions.gesture.wheelUp",
                "uiEditor.inputActions.device.touch uiEditor.inputActions.menu.touchSlideDown",
            ].join("\n"),
        );
    });
});
