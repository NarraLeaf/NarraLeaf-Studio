import { describe, expect, it } from "vitest";
import {
    createWheelGestureGate,
    isWheelPointerGesture,
    readInputEventTime,
    WHEEL_GESTURE_SILENCE_MS,
} from "./wheelGesture";

/**
 * A stand-in for one physical wheel event.
 *
 * The gate only ever uses the event as a map key, so an object literal is the whole of what it
 * needs - and driving the clock by hand is the only way to sit exactly on the boundary rather than
 * near it.
 */
function wheelEvent(): object {
    return {};
}

describe("isWheelPointerGesture", () => {
    it("names the four wheel directions and nothing else", () => {
        expect(isWheelPointerGesture("wheelUp")).toBe(true);
        expect(isWheelPointerGesture("wheelDown")).toBe(true);
        expect(isWheelPointerGesture("wheelLeft")).toBe(true);
        expect(isWheelPointerGesture("wheelRight")).toBe(true);
        expect(isWheelPointerGesture("click")).toBe(false);
        expect(isWheelPointerGesture("doubleClick")).toBe(false);
        expect(isWheelPointerGesture("rightClick")).toBe(false);
    });
});

describe("a wheel gesture nothing has claimed", () => {
    it("admits every event of it", () => {
        const gate = createWheelGestureGate();

        expect(gate.admit(wheelEvent(), 0)).toBe(true);
        expect(gate.admit(wheelEvent(), 16)).toBe(true);
        expect(gate.admit(wheelEvent(), 32)).toBe(true);
    });

    it("admits an event that arrives after any amount of silence", () => {
        const gate = createWheelGestureGate();

        expect(gate.admit(wheelEvent(), 0)).toBe(true);
        expect(gate.admit(wheelEvent(), 100_000)).toBe(true);
    });
});

describe("a wheel gesture something has claimed", () => {
    it("swallows the rest of the momentum tail", () => {
        const gate = createWheelGestureGate();

        expect(gate.admit(wheelEvent(), 0)).toBe(true);
        gate.claim(0);

        // A trackpad tail: frame-cadence events for a second, every one of them inside the window.
        for (let at = 16; at <= 1_000; at += 16) {
            expect(gate.admit(wheelEvent(), at), `event at ${at}ms should be swallowed`).toBe(false);
        }
    });

    it("keeps the gesture alive across a stalled frame inside the silence window", () => {
        const gate = createWheelGestureGate();

        gate.admit(wheelEvent(), 0);
        gate.claim(0);

        // Events coalesced behind a 150ms hitch arrive as one late delivery, still the same flick.
        expect(gate.admit(wheelEvent(), 150)).toBe(false);
        expect(gate.admit(wheelEvent(), 166)).toBe(false);
    });

    it("ends at the silence and not a millisecond before it", () => {
        const inside = createWheelGestureGate();
        inside.admit(wheelEvent(), 0);
        inside.claim(0);
        expect(inside.admit(wheelEvent(), WHEEL_GESTURE_SILENCE_MS)).toBe(false);

        const after = createWheelGestureGate();
        after.admit(wheelEvent(), 0);
        after.claim(0);
        expect(after.admit(wheelEvent(), WHEEL_GESTURE_SILENCE_MS + 1)).toBe(true);
    });

    it("measures the silence from the last event of the tail, not from the claim", () => {
        const gate = createWheelGestureGate();

        gate.admit(wheelEvent(), 0);
        gate.claim(0);
        // A tail that runs for a second: each swallowed event pushes the window along, so the
        // gesture is still the same one well past the threshold from where it started.
        for (let at = 100; at <= 1_000; at += 100) {
            expect(gate.admit(wheelEvent(), at)).toBe(false);
        }
        // Every one of those was swallowed and every one of them pushed the window along, so the
        // gesture is only over a full silence after the last of them - not after the claim.
        expect(gate.admit(wheelEvent(), 1_000 + WHEEL_GESTURE_SILENCE_MS + 1)).toBe(true);
    });

    it("lets a second flick after the silence claim and be claimed in its turn", () => {
        const gate = createWheelGestureGate();

        gate.admit(wheelEvent(), 0);
        gate.claim(0);
        expect(gate.admit(wheelEvent(), 100)).toBe(false);

        const second = 100 + WHEEL_GESTURE_SILENCE_MS + 1;
        expect(gate.admit(wheelEvent(), second)).toBe(true);
        gate.claim(second);
        expect(gate.admit(wheelEvent(), second + 16)).toBe(false);
    });

    it("still counts the event that did the claiming, however often it is asked", () => {
        const gate = createWheelGestureGate();
        const consuming = wheelEvent();

        // The element head asks on the way up, the surface shell asks after it, and only then does
        // anything consume. Asking again afterwards must not retract the answer already given.
        expect(gate.admit(consuming, 0)).toBe(true);
        expect(gate.admit(consuming, 0)).toBe(true);
        gate.claim(0);
        expect(gate.admit(consuming, 0)).toBe(true);
        expect(gate.admit(wheelEvent(), 16)).toBe(false);
    });
});

describe("reset", () => {
    it("forgets the gesture in flight", () => {
        const gate = createWheelGestureGate();

        gate.admit(wheelEvent(), 0);
        gate.claim(0);
        expect(gate.admit(wheelEvent(), 16)).toBe(false);

        gate.reset();
        expect(gate.admit(wheelEvent(), 32)).toBe(true);
    });
});

describe("readInputEventTime", () => {
    it("prefers the browser's own stamp", () => {
        expect(readInputEventTime({ timeStamp: 1234.5 })).toBe(1234.5);
    });

    it("falls back to a clock when the host left it at zero or absent", () => {
        expect(readInputEventTime({ timeStamp: 0 })).toBeGreaterThan(0);
        expect(readInputEventTime({})).toBeGreaterThan(0);
        expect(readInputEventTime(null)).toBeGreaterThan(0);
    });
});
