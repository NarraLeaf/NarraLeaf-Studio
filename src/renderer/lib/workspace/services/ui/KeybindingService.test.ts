import { describe, expect, it } from "vitest";
import {
    formatKeybinding,
    keybindingFromKeyboardEvent,
    matchesKeybinding,
    parseKeybinding,
    sanitizeKeybindingOverrides,
} from "./KeybindingService";

function keyEvent(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
    return {
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ...init,
    } as KeyboardEvent;
}

describe("parseKeybinding", () => {
    it("resolves mod to meta on macOS and ctrl elsewhere", () => {
        expect(parseKeybinding("mod+z", true)).toMatchObject({ meta: true, ctrl: false, key: "z" });
        expect(parseKeybinding("mod+z", false)).toMatchObject({ meta: false, ctrl: true, key: "z" });
    });

    it("keeps literal ctrl as the Control key on both platforms", () => {
        // ctrl+tab tab-switching must stay Control on macOS (⌘+Tab is the OS app switcher).
        expect(parseKeybinding("ctrl+tab", true)).toMatchObject({ ctrl: true, meta: false, key: "tab" });
        expect(parseKeybinding("ctrl+tab", false)).toMatchObject({ ctrl: true, meta: false, key: "tab" });
    });

    it("stacks mod with other modifiers", () => {
        expect(parseKeybinding("mod+shift+z", true)).toMatchObject({ meta: true, shift: true, key: "z" });
    });
});

describe("matchesKeybinding", () => {
    it("matches ⌘Z against mod+z on macOS but not plain Ctrl+Z", () => {
        const parsed = parseKeybinding("mod+z", true);
        expect(matchesKeybinding(keyEvent({ key: "z", metaKey: true }), parsed)).toBe(true);
        expect(matchesKeybinding(keyEvent({ key: "z", ctrlKey: true }), parsed)).toBe(false);
    });

    it("matches Ctrl+Z against mod+z off macOS", () => {
        const parsed = parseKeybinding("mod+z", false);
        expect(matchesKeybinding(keyEvent({ key: "z", ctrlKey: true }), parsed)).toBe(true);
        expect(matchesKeybinding(keyEvent({ key: "z", metaKey: true }), parsed)).toBe(false);
    });

    it("rejects extra modifiers so mod+z and mod+shift+z stay distinct", () => {
        const parsed = parseKeybinding("mod+z", true);
        expect(matchesKeybinding(keyEvent({ key: "z", metaKey: true, shiftKey: true }), parsed)).toBe(false);
    });
});

describe("formatKeybinding", () => {
    it("renders mod as the platform's real modifier, never the literal token", () => {
        expect(formatKeybinding("mod+c", true)).toBe("⌘C");
        expect(formatKeybinding("mod+c", false)).toBe("Ctrl+C");
    });

    it("shows literal ctrl as Control on macOS rather than ⌘", () => {
        // ctrl+tab really is Control there — displaying ⌘⇥ would be a lie.
        expect(formatKeybinding("ctrl+tab", true)).toBe("⌃Tab");
        expect(formatKeybinding("ctrl+tab", false)).toBe("Ctrl+Tab");
    });

    it("orders and joins stacked modifiers per platform convention", () => {
        expect(formatKeybinding("mod+shift+t", true)).toBe("⌘⇧T");
        expect(formatKeybinding("mod+shift+t", false)).toBe("Ctrl+Shift+T");
    });

    it("gives named keys a readable label", () => {
        expect(formatKeybinding("delete", false)).toBe("Delete");
        expect(formatKeybinding("mod+=", true)).toBe("⌘+");
        expect(formatKeybinding("escape", false)).toBe("Esc");
    });
});

describe("sanitizeKeybindingOverrides", () => {
    it("keeps only non-empty string values", () => {
        expect(
            sanitizeKeybindingOverrides({
                "save": "mod+shift+s",
                "blank": "   ",
                "num": 3,
                "obj": { key: "x" },
            }),
        ).toEqual({ save: "mod+shift+s" });
    });

    it("returns empty for non-object input", () => {
        expect(sanitizeKeybindingOverrides(undefined)).toEqual({});
        expect(sanitizeKeybindingOverrides("mod+s")).toEqual({});
        expect(sanitizeKeybindingOverrides(["mod+s"])).toEqual({});
    });
});

describe("keybindingFromKeyboardEvent", () => {
    it("returns null for a bare modifier press", () => {
        expect(keybindingFromKeyboardEvent(keyEvent({ key: "Shift", shiftKey: true }), true)).toBeNull();
        expect(keybindingFromKeyboardEvent(keyEvent({ key: "Meta", metaKey: true }), true)).toBeNull();
    });

    it("records the primary modifier as mod on both platforms", () => {
        expect(keybindingFromKeyboardEvent(keyEvent({ key: "k", metaKey: true }), true)).toBe("mod+k");
        expect(keybindingFromKeyboardEvent(keyEvent({ key: "k", ctrlKey: true }), false)).toBe("mod+k");
    });

    it("keeps macOS Control as literal ctrl alongside mod", () => {
        expect(
            keybindingFromKeyboardEvent(keyEvent({ key: "k", metaKey: true, ctrlKey: true }), true),
        ).toBe("mod+ctrl+k");
    });

    it("stacks alt/shift and normalizes space", () => {
        expect(
            keybindingFromKeyboardEvent(keyEvent({ key: " ", altKey: true, shiftKey: true }), false),
        ).toBe("alt+shift+space");
    });

    it("allows a bare non-modifier key (function keys bind alone)", () => {
        expect(keybindingFromKeyboardEvent(keyEvent({ key: "F2" }), true)).toBe("f2");
    });
});
