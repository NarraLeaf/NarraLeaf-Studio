import { describe, expect, it } from "vitest";
import {
    detectUIInputHintControllerFamily,
    normalizeUIInputHintsProps,
    uiInputHintGamepadGlyph,
    uiInputHintKeyGlyph,
} from "./inputHints";
import { UI_NAVIGATION_SLOT_PRESET_BINDINGS, uiElementHasFocusLook } from "./navigation";

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

    it("finds the glyph for a key in the spelling bindings are stored in", () => {
        // Saved bindings and the navigation presets read "Arrow Up", not the event's "ArrowUp"; the
        // bar printed the words until the lookup went through the key parser's names.
        for (const binding of UI_NAVIGATION_SLOT_PRESET_BINDINGS.up) {
            if (binding.kind === "key") {
                expect(uiInputHintKeyGlyph(binding.key).text).toBe("↑");
            }
        }
        expect(uiInputHintKeyGlyph("Arrow Left").text).toBe("←");
        expect(uiInputHintKeyGlyph("Shift+Arrow Down").text).toBe("Shift+↓");
        expect(uiInputHintKeyGlyph("esc").text).toBe("Esc");
        expect(uiInputHintKeyGlyph("backspace").text).toBe("⌫");
        expect(uiInputHintKeyGlyph("Space").text).toBe("Space");
        // A pointer gesture shares the row and keeps its own text.
        expect(uiInputHintKeyGlyph("doubleClick").text).toBe("doubleClick");
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
