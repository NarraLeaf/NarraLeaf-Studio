import { describe, expect, it } from "vitest";
import {
    blueprintKeyboardBindingMatchesEvent,
    formatBlueprintKeyboardBinding,
    formatBlueprintKeyboardBindingFromEvent,
    parseBlueprintKeyboardBinding,
} from "./graph";

describe("blueprint keyboard bindings", () => {
    it("formats legacy key names and captured keyboard combos", () => {
        expect(formatBlueprintKeyboardBinding("escape")).toBe("Escape");
        expect(formatBlueprintKeyboardBinding("spacebar")).toBe("Space");
        expect(formatBlueprintKeyboardBinding("ctrl+shift+s")).toBe("Ctrl+Shift+S");
        expect(formatBlueprintKeyboardBindingFromEvent({ key: "s", ctrlKey: true, shiftKey: true })).toBe(
            "Ctrl+Shift+S",
        );
        expect(formatBlueprintKeyboardBindingFromEvent({ key: "Control", ctrlKey: true })).toBe("Ctrl");
    });

    it("parses modifier bindings without duplicating the modifier key", () => {
        expect(parseBlueprintKeyboardBinding("Ctrl")).toMatchObject({
            key: "control",
            ctrlKey: true,
            hasExplicitModifiers: true,
        });
        expect(formatBlueprintKeyboardBinding("Ctrl+Shift")).toBe("Ctrl+Shift");
    });

    it("matches legacy single-key bindings without requiring modifier state", () => {
        expect(blueprintKeyboardBindingMatchesEvent("escape", { key: "Escape", ctrlKey: true })).toBe(true);
        expect(blueprintKeyboardBindingMatchesEvent("escape", { key: "Enter", ctrlKey: true })).toBe(false);
    });

    it("matches explicit keyboard combos by key and modifier state", () => {
        expect(blueprintKeyboardBindingMatchesEvent("Ctrl+S", { key: "s", ctrlKey: true })).toBe(true);
        expect(blueprintKeyboardBindingMatchesEvent("Ctrl+S", { key: "s", ctrlKey: false })).toBe(false);
        expect(blueprintKeyboardBindingMatchesEvent("Ctrl+S", { key: "s", ctrlKey: true, shiftKey: true })).toBe(
            false,
        );
    });
});
