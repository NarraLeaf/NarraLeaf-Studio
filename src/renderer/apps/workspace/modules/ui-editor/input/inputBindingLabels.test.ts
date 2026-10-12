import { describe, expect, it } from "vitest";
import { en } from "@shared/i18n/catalog/en";
import { flattenCatalog } from "@shared/i18n/flatten";
import { createTranslator, type InterpolationParams, type TranslationKey } from "@shared/i18n";
import { formatBlueprintKeyboardBindingFromEvent } from "@shared/types/blueprint/graph";
import {
    UI_INPUT_POINTER_GESTURES,
    inputBindingDevices,
    normalizeUIInputBinding,
} from "@shared/types/ui-editor/inputAction";
import { UI_NAVIGATION_SLOT_PRESET_BINDINGS } from "@shared/types/ui-editor/navigation";
import { getKeyboardBindingLabel } from "@/lib/ui-editor/keyboardBindingLabel";
import {
    INPUT_BINDING_DEVICES,
    INPUT_DEVICE_GESTURE_OFFERS,
    getInputBindingDeviceActs,
    getInputBindingDevices,
    getInputBindingDevicesLabel,
    getGamepadButtonLabel,
    getInputBindingLabel,
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

describe("what a key binding is called", () => {
    const enT = createTranslator("en").t;
    const zhT = createTranslator("zh").t;
    const jaT = createTranslator("ja").t;
    const keyLabel = (key: string, t: typeof enT) => getInputBindingLabel({ kind: "key", key }, t);

    it("names a key with no word on its keycap in the author's language", () => {
        // The reported defect: the arrows the navigation intents start bound to read in English
        // under a Chinese interface.
        expect(keyLabel("Arrow Up", zhT)).toBe("上方向键");
        expect(keyLabel("Arrow Left", zhT)).toBe("左方向键");
        expect(keyLabel("Space", zhT)).toBe("空格键");
        expect(keyLabel("Ctrl+Plus", zhT)).toBe("Ctrl+加号键");
        expect(keyLabel("Arrow Down", jaT)).toBe("下矢印キー");
        expect(keyLabel("Arrow Up", enT)).toBe("Arrow Up");
        expect(keyLabel("Space", enT)).toBe("Space");
    });

    it("keeps the modifiers by their keycap names in front of a translated key", () => {
        expect(keyLabel("Shift+Space", zhT)).toBe("Shift+空格键");
        expect(keyLabel("ctrl+alt+arrowright", zhT)).toBe("Ctrl+Alt+右方向键");
        expect(keyLabel("Shift", zhT)).toBe("Shift");
    });

    it("names every other key by its keycap, spelled as the keycap spells it", () => {
        for (const t of [enT, zhT]) {
            expect(keyLabel("Escape", t)).toBe("Esc");
            expect(keyLabel("Enter", t)).toBe("Enter");
            expect(keyLabel("Shift+Tab", t)).toBe("Shift+Tab");
            expect(keyLabel("pageup", t)).toBe("PageUp");
            expect(keyLabel("pagedown", t)).toBe("PageDown");
            expect(keyLabel("home", t)).toBe("Home");
            expect(keyLabel("backspace", t)).toBe("Backspace");
            expect(keyLabel("f5", t)).toBe("F5");
            expect(keyLabel("Ctrl+s", t)).toBe("Ctrl+S");
        }
    });

    it("names a key being captured the way the chip will name it", () => {
        // The capture preview holds the stored spelling and is shown through the same helper.
        const pressed = formatBlueprintKeyboardBindingFromEvent({ key: "ArrowUp", ctrlKey: true });
        expect(pressed).toBe("Ctrl+Arrow Up");
        expect(getKeyboardBindingLabel(pressed, zhT)).toBe("Ctrl+上方向键");
        expect(getKeyboardBindingLabel(formatBlueprintKeyboardBindingFromEvent({ key: " " }), zhT)).toBe("空格键");
    });

    it("leaves a binding it cannot read as written, and every preset readable", () => {
        expect(keyLabel("+++", zhT)).toBe("+++");
        for (const bindings of Object.values(UI_NAVIGATION_SLOT_PRESET_BINDINGS)) {
            for (const binding of bindings) {
                if (binding.kind === "key") {
                    expect(getKeyboardBindingLabel(binding.key, zhT), binding.key).not.toBe("");
                }
            }
        }
    });

    it("never changes what is stored", () => {
        // Display is drawn from the stored spelling and never written back into it.
        keyLabel("Arrow Up", zhT);
        expect(normalizeUIInputBinding({ kind: "key", key: "Arrow Up" })).toEqual({ kind: "key", key: "Arrow Up" });
        expect(normalizeUIInputBinding({ kind: "key", key: "esc" })).toEqual({ kind: "key", key: "Escape" });
        expect(normalizeUIInputBinding({ kind: "key", key: "pageup" })).toEqual({ kind: "key", key: "pageup" });
    });
});

describe("what a gamepad binding is called", () => {
    const zhT = createTranslator("zh").t;
    const enT = createTranslator("en").t;

    it("names the pad's directions in the author's language and keeps printed buttons as printed", () => {
        expect(getInputBindingLabel({ kind: "gamepad", button: "D-pad Up" }, zhT)).toBe("十字键上");
        expect(getInputBindingLabel({ kind: "gamepad", button: "Left Stick Right" }, zhT)).toBe("左摇杆右");
        expect(getInputBindingLabel({ kind: "gamepad", button: "A" }, zhT)).toBe("A");
        expect(getInputBindingLabel({ kind: "gamepad", button: "Start" }, zhT)).toBe("Start");
        expect(getInputBindingLabel({ kind: "gamepad", button: "D-pad Up" }, enT)).toBe("D-pad Up");
    });

    it("reads an alias through the stored name", () => {
        // An alias a binding may be read in is named as the canonical button it stands for.
        expect(getGamepadButtonLabel("lb", zhT)).toBe("LB");
    });
});
