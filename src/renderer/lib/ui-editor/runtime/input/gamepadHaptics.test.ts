import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStoryRumble, STORY_RUMBLE_PRESETS } from "@shared/types/story";
import { playGamepadRumble, stopGamepadRumble, type GamepadSource } from "./gamepadHaptics";

/**
 * A fake pad carries only the two fields the module looks at - `mapping` and `vibrationActuator` -
 * because a real `Gamepad` is a live object the platform owns and a test cannot construct one.
 */
type ActuatorStub = {
    playEffect?: ReturnType<typeof vi.fn>;
    reset?: ReturnType<typeof vi.fn>;
};

function padOf(mapping: string, actuator?: ActuatorStub): Gamepad {
    return { mapping, ...(actuator ? { vibrationActuator: actuator } : {}) } as unknown as Gamepad;
}

function sourceOf(pads: (Gamepad | null)[]): GamepadSource {
    return () => pads;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("resolveStoryRumble", () => {
    it("plays the default preset for a bare row", () => {
        expect(resolveStoryRumble({ action: "input", operation: "rumble" })).toEqual(STORY_RUMBLE_PRESETS.pulse);
    });

    it("lets the row's own numbers override the preset it names", () => {
        const resolved = resolveStoryRumble({ action: "input", operation: "rumble", preset: "impact", durationMs: 400 });
        expect(resolved).toEqual({ ...STORY_RUMBLE_PRESETS.impact, durationMs: 400 });
    });

    it("reads a motor custom does not mention as off, never as the table's value", () => {
        const resolved = resolveStoryRumble({ action: "input", operation: "rumble", preset: "custom", strongMagnitude: 0.4 });
        expect(resolved.strongMagnitude).toBe(0.4);
        expect(resolved.weakMagnitude).toBe(0);
        expect(resolved.durationMs).toBeGreaterThan(0);
    });

    it("clamps magnitudes into 0..1 and the length to what an engine honours", () => {
        const resolved = resolveStoryRumble({
            action: "input",
            operation: "rumble",
            preset: "custom",
            strongMagnitude: 4,
            weakMagnitude: -2,
            durationMs: 60_000,
        });
        expect(resolved).toEqual({ strongMagnitude: 1, weakMagnitude: 0, durationMs: 5000 });
    });
});

describe("playGamepadRumble", () => {
    it("shakes every standard pad and skips the rest", () => {
        const standard = { playEffect: vi.fn(() => Promise.resolve("complete")) };
        const other = { playEffect: vi.fn(() => Promise.resolve("complete")) };
        void playGamepadRumble(STORY_RUMBLE_PRESETS.impact, {
            source: sourceOf([padOf("standard", standard), padOf("", other), null, padOf("standard")]),
        });
        expect(standard.playEffect).toHaveBeenCalledWith("dual-rumble", {
            startDelay: 0,
            duration: 150,
            strongMagnitude: 1,
            weakMagnitude: 0.7,
        });
        expect(other.playEffect).not.toHaveBeenCalled();
    });

    it("is silent rather than throwing when the actuator refuses", async () => {
        const refusing = {
            playEffect: vi.fn(() => {
                throw new Error("NotSupportedError");
            }),
        };
        const rejecting = { playEffect: vi.fn(() => Promise.reject(new Error("aborted"))) };
        await expect(playGamepadRumble(STORY_RUMBLE_PRESETS.tap, {
            source: sourceOf([padOf("standard", refusing), padOf("standard", rejecting)]),
        })).resolves.toBeUndefined();
    });

    it("waits out the rumble on its own timer when asked to", async () => {
        const actuator = { playEffect: vi.fn(() => new Promise(() => undefined)) };
        let done = false;
        void playGamepadRumble(STORY_RUMBLE_PRESETS.pulse, { wait: true, source: sourceOf([padOf("standard", actuator)]) })
            .then(() => {
                done = true;
            });
        await vi.advanceTimersByTimeAsync(STORY_RUMBLE_PRESETS.pulse.durationMs - 1);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(done).toBe(true);
    });

    it("stops the pad when the story moves away mid-rumble", async () => {
        const actuator = { playEffect: vi.fn(() => Promise.resolve()), reset: vi.fn(() => Promise.resolve()) };
        const source = sourceOf([padOf("standard", actuator)]);
        const abort = new AbortController();
        void playGamepadRumble(STORY_RUMBLE_PRESETS.quake, { wait: false, signal: abort.signal, source });
        await vi.advanceTimersByTimeAsync(100);
        abort.abort();
        expect(actuator.reset).toHaveBeenCalledTimes(1);
    });
});

describe("stopGamepadRumble", () => {
    it("resets and then plays silence, for an engine that only takes a new effect", () => {
        const actuator = { playEffect: vi.fn(() => Promise.resolve()), reset: vi.fn(() => Promise.resolve()) };
        stopGamepadRumble(sourceOf([padOf("standard", actuator)]));
        expect(actuator.reset).toHaveBeenCalledTimes(1);
        expect(actuator.playEffect).toHaveBeenCalledWith("dual-rumble", expect.objectContaining({ strongMagnitude: 0, weakMagnitude: 0 }));
    });
});
