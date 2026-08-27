import { describe, expect, it } from "vitest";
import { en } from "@shared/i18n/catalog/en";
import { flattenCatalog } from "@shared/i18n/flatten";
import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import { UI_INPUT_POINTER_GESTURES } from "@shared/types/ui-editor/inputAction";
import { UI_INPUT_ACTION_SOURCES } from "@shared/types/ui-editor/inputActionEvent";
import {
    INPUT_BINDING_DEVICES,
    getInputBindingDevices,
    getInputBindingDevicesLabel,
    getInputDeviceGestures,
    getInputDeviceLabel,
    getInputPointerGestureLabel,
} from "./inputBindingLabels";

/**
 * What the two author panels say about which device reaches a binding.
 *
 * The chips are one flat row and the add menu is grouped by device, so both are drawn from the
 * derivation in `@shared/types/ui-editor/inputAction` rather than from anything stored. These are
 * the answers a panel would be lying about if they drifted: a gesture that reaches two devices has
 * to appear under both, a gesture that reaches none would silently vanish from the picker, and a
 * device with no name in the catalogue would be drawn as its own key.
 */

/** Resolves a key to itself, so a test can assert which key a label came from. */
const echo = (key: TranslationKey, _params?: InterpolationParams) => key as string;

const catalogKeys = new Set(flattenCatalog(en).keys());

describe("input binding devices", () => {
    it("lists the devices of a binding in the panels' order", () => {
        expect(getInputBindingDevices({ kind: "pointer", gesture: "click" })).toEqual(["pointer", "touch"]);
        expect(getInputBindingDevices({ kind: "pointer", gesture: "wheelUp" })).toEqual(["pointer", "touch"]);
        expect(getInputBindingDevices({ kind: "pointer", gesture: "rightClick" })).toEqual(["pointer"]);
        expect(getInputBindingDevices({ kind: "pointer", gesture: "longPress" })).toEqual(["touch"]);
        expect(getInputBindingDevices({ kind: "key", key: "Escape" })).toEqual(["key"]);
    });

    it("marks every binding with at least one device", () => {
        for (const gesture of UI_INPUT_POINTER_GESTURES) {
            expect(getInputBindingDevices({ kind: "pointer", gesture })).not.toHaveLength(0);
        }
    });

    it("names each device on its own line", () => {
        expect(getInputBindingDevicesLabel({ kind: "pointer", gesture: "click" }, echo)).toBe(
            `uiEditor.inputActions.device.pointer
uiEditor.inputActions.device.touch`,
        );
    });

    it("offers no device a binding cannot reach", () => {
        expect(INPUT_BINDING_DEVICES).not.toContain("gamepad");
        for (const device of INPUT_BINDING_DEVICES) {
            expect(UI_INPUT_ACTION_SOURCES).toContain(device);
            expect(catalogKeys).toContain(`uiEditor.inputActions.device.${device}`);
        }
    });
});

describe("the gestures each device group offers", () => {
    it("offers every gesture under at least one device", () => {
        for (const gesture of UI_INPUT_POINTER_GESTURES) {
            const groups = INPUT_BINDING_DEVICES.filter(device => getInputDeviceGestures(device).includes(gesture));
            expect(groups.length).toBeGreaterThan(0);
        }
    });

    it("offers a gesture two devices reach under both of them", () => {
        for (const gesture of ["click", "wheelUp", "wheelDown", "wheelLeft", "wheelRight"] as const) {
            expect(getInputDeviceGestures("pointer")).toContain(gesture);
            expect(getInputDeviceGestures("touch")).toContain(gesture);
        }
    });

    it("leaves the keyboard group to key capture", () => {
        expect(getInputDeviceGestures("key")).toEqual([]);
    });

    it("names every gesture in the source catalogue", () => {
        for (const gesture of UI_INPUT_POINTER_GESTURES) {
            expect(catalogKeys).toContain(getInputPointerGestureLabel(gesture, echo));
        }
        expect(getInputDeviceLabel("touch", echo)).toBe("uiEditor.inputActions.device.touch");
    });
});
