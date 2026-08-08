import { describe, expect, it } from "vitest";
import {
    defaultSwitchWidgetProps,
    getUISwitchChildSlot,
    normalizeSwitchProps,
    resolveSwitchRuntimeValue,
    UI_SWITCH_ON_VARIANT_ID,
} from "./switch";

describe("UI switch helpers", () => {
    it("fills defaults in for missing props", () => {
        expect(normalizeSwitchProps(undefined)).toEqual(defaultSwitchWidgetProps);
        expect(normalizeSwitchProps({})).toEqual(defaultSwitchWidgetProps);
    });

    it("keeps authored props that are well formed", () => {
        expect(
            normalizeSwitchProps({
                checked: true,
                interactionDisabled: true,
                trackElementId: "track",
                thumbElementId: "thumb",
            }),
        ).toEqual({
            checked: true,
            interactionDisabled: true,
            trackElementId: "track",
            thumbElementId: "thumb",
        });
    });

    it("treats anything but a literal true as off", () => {
        // Truthy-but-not-boolean values must not turn a switch on: a stored "false" string would.
        expect(normalizeSwitchProps({ checked: "true", interactionDisabled: 1 })).toEqual(
            defaultSwitchWidgetProps,
        );
        expect(normalizeSwitchProps({ checked: "false" }).checked).toBe(false);
        expect(normalizeSwitchProps({ checked: null }).checked).toBe(false);
    });

    it("drops part ids that are not strings", () => {
        expect(normalizeSwitchProps({ trackElementId: 12, thumbElementId: null })).toEqual(
            defaultSwitchWidgetProps,
        );
    });

    it("resolves the runtime value from authored props", () => {
        expect(resolveSwitchRuntimeValue(undefined)).toEqual({ checked: false });
        expect(resolveSwitchRuntimeValue({ checked: true, trackElementId: "track" })).toEqual({
            checked: true,
        });
    });

    it("reads the child slot only from the two known ids", () => {
        expect(getUISwitchChildSlot({ switchSlot: "track" })).toBe("track");
        expect(getUISwitchChildSlot({ switchSlot: "thumb" })).toBe("thumb");
        expect(getUISwitchChildSlot({ switchSlot: "handle" })).toBeNull();
        expect(getUISwitchChildSlot({ sliderSlot: "track" })).toBeNull();
        expect(getUISwitchChildSlot(undefined)).toBeNull();
    });

    it("keeps the on-variant id stable", () => {
        // Persisted in project appearance models; renaming it orphans every authored on-state.
        expect(UI_SWITCH_ON_VARIANT_ID).toBe("on");
    });
});
