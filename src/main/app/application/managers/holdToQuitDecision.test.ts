import { describe, expect, it } from "vitest";
import { decideHoldAction, type HoldState } from "./holdToQuitDecision";

type PartialInput = {
    type?: "keyDown" | "keyUp";
    key: string;
    meta?: boolean;
    control?: boolean;
    alt?: boolean;
    shift?: boolean;
};

function press(input: PartialInput) {
    return {
        type: input.type ?? "keyDown",
        key: input.key,
        meta: input.meta ?? false,
        control: input.control ?? false,
        alt: input.alt ?? false,
        shift: input.shift ?? false,
    } as Electron.Input;
}

const IDLE: HoldState = { armed: true, holding: false };
const HOLDING: HoldState = { armed: true, holding: true };

describe("decideHoldAction", () => {
    it("starts a hold on ⌘Q", () => {
        expect(decideHoldAction(press({ key: "q", meta: true }), IDLE)).toBe("begin");
    });

    it("takes the auto-repeats of a hold without restarting it", () => {
        expect(decideHoldAction(press({ key: "q", meta: true }), HOLDING)).toBe("swallow");
    });

    it("leaves ⌘Q alone when the preference is off, so the menu quits as it always did", () => {
        expect(decideHoldAction(press({ key: "q", meta: true }), { armed: false, holding: false }))
            .toBe("ignore");
    });

    /**
     * ⇧⌘Q and ⌥⌘Q are the system's log-out shortcuts. Swallowing either would break a gesture
     * aimed past Studio at the operating system, and neither should start a hold.
     */
    it.each([
        ["⇧⌘Q", press({ key: "Q", meta: true, shift: true })],
        ["⌥⌘Q", press({ key: "q", meta: true, alt: true })],
        ["⌃⌘Q", press({ key: "q", meta: true, control: true })],
        ["a bare Q", press({ key: "q" })],
    ])("does not claim %s", (_name, input) => {
        expect(decideHoldAction(input, IDLE)).toBe("ignore");
    });

    it("ends the hold when ⌘ is released", () => {
        expect(decideHoldAction(press({ type: "keyUp", key: "Meta" }), HOLDING)).toBe("cancel");
    });

    /**
     * macOS withholds key-up for ordinary keys while Command is down, so this rarely arrives there.
     * It is still the correct answer wherever it does.
     */
    it("ends the hold when Q is released, on the platforms that report it", () => {
        expect(decideHoldAction(press({ type: "keyUp", key: "q", meta: true }), HOLDING)).toBe("cancel");
    });

    it("ignores key-ups when nothing is being held", () => {
        expect(decideHoldAction(press({ type: "keyUp", key: "Meta" }), IDLE)).toBe("ignore");
        expect(decideHoldAction(press({ type: "keyUp", key: "a" }), IDLE)).toBe("ignore");
    });

    it("ends the hold when another command is started mid-hold", () => {
        expect(decideHoldAction(press({ key: "s", meta: true }), HOLDING)).toBe("cancel");
        expect(decideHoldAction(press({ key: "Escape" }), HOLDING)).toBe("cancel");
    });

    /**
     * The modifiers are part of the gesture: ⌘ arrives as its own key-down a moment before Q does,
     * and adding ⇧ or ⌥ while holding is not a change of mind. Cancelling on these would make the
     * hold impossible to complete.
     */
    it.each(["Meta", "Shift", "Alt", "Control", "CapsLock"])("survives %s being pressed mid-hold", (key) => {
        expect(decideHoldAction(press({ key, meta: true }), HOLDING)).toBe("ignore");
    });
});
