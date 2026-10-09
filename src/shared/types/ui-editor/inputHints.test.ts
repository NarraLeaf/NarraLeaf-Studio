import { describe, expect, it } from "vitest";
import {
    detectUIInputHintControllerFamily,
    normalizeUIInputHintsProps,
    uiInputHintGamepadGlyph,
    uiInputHintKeyGlyph,
} from "./inputHints";
import { uiElementHasFocusLook } from "./navigation";

describe("the hint bar's glyphs", () => {
    it("reads the pad family off the controller's id", () => {
        expect(detectUIInputHintControllerFamily("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)")).toBe("playstation");
        expect(detectUIInputHintControllerFamily("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)")).toBe("nintendo");
        expect(detectUIInputHintControllerFamily("Xbox Wireless Controller")).toBe("xbox");
        expect(detectUIInputHintControllerFamily(undefined)).toBe("xbox");
    });

    it("prints each family's marks on the same buttons", () => {
        expect(uiInputHintGamepadGlyph("A", "xbox")).toEqual({ text: "A", shape: "round" });
        expect(uiInputHintGamepadGlyph("A", "playstation").text).toBe("✕");
        // The bottom button of a Nintendo pad says B.
        expect(uiInputHintGamepadGlyph("A", "nintendo").text).toBe("B");
        expect(uiInputHintGamepadGlyph("LB", "playstation")).toEqual({ text: "L1", shape: "bar" });
    });

    it("prints a key as it is printed on the keyboard", () => {
        expect(uiInputHintKeyGlyph("Escape").text).toBe("Esc");
        expect(uiInputHintKeyGlyph("Shift+Tab").text).toBe("Shift+Tab");
        expect(uiInputHintKeyGlyph("ArrowUp").text).toBe("↑");
    });

    it("keeps the author's words and drops what is not a setting", () => {
        const props = normalizeUIInputHintsProps({ backLabel: "Return", showFor: "nonsense", fontSize: -4 });
        expect(props.backLabel).toBe("Return");
        expect(props.showFor).toBe("keysAndGamepad");
        expect(props.fontSize).toBe(6);
    });
});

describe("a look for holding the focus", () => {
    it("is an appearance row that applies while focused, wherever the widget keeps its appearance", () => {
        const focused = { props: { appearance: { variants: [{ propertyGroups: { color: { rows: [{ value: "#fff" }, { conditions: { focused: true }, value: "#f00" }] } } }] } } };
        const hoveredOnly = { props: { appearance: { variants: [{ propertyGroups: { color: { rows: [{ conditions: { hovered: true }, value: "#f00" }] } } }] } } };
        expect(uiElementHasFocusLook(focused)).toBe(true);
        expect(uiElementHasFocusLook(hoveredOnly)).toBe(false);
        expect(uiElementHasFocusLook({ props: {} })).toBe(false);
    });
});
