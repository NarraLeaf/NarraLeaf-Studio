/**
 * The output gate behind "mute when unfocused".
 *
 * A fake output rather than an engine: what is worth pinning is not that a number reached a gain
 * node, it is the four things the gate has to be right about - that the preference off means
 * nothing happens at all, that the volume comes back exactly as it was found, that a teardown never
 * leaves a zero behind for the engine to read as the player's choice, and that a re-assert over an
 * output something else re-opened does not lose the value it re-opened to.
 *
 * Comments in English per project convention.
 */
import { describe, expect, it } from "vitest";
import { createFocusMuteController, type FocusMuteOutput } from "./focusMute";

/** An audio output that records every write, standing in for the engine's. */
function fakeOutput(initial = 1): FocusMuteOutput & { writes: number[]; value: number } {
    const output = {
        value: initial,
        writes: [] as number[],
        getGlobalVolume: () => output.value,
        setGlobalVolume: (volume: number) => {
            output.value = volume;
            output.writes.push(volume);
        },
    };
    return output;
}

describe("mute when unfocused", () => {
    it("leaves the output alone while the preference is off", () => {
        const output = fakeOutput(0.7);
        const gate = createFocusMuteController({ output: () => output });

        expect(gate.update({ enabled: false, focused: false })).toBe(false);
        expect(gate.update({ enabled: false, focused: true })).toBe(false);

        expect(output.writes).toEqual([]);
        expect(output.value).toBe(0.7);
        expect(gate.getGain()).toBe(1);
    });

    it("silences the output on blur and restores exactly what it found on focus", () => {
        const output = fakeOutput(0.42);
        const gate = createFocusMuteController({ output: () => output });

        expect(gate.update({ enabled: true, focused: false })).toBe(true);
        expect(output.value).toBe(0);
        expect(gate.getGain()).toBe(0);

        expect(gate.update({ enabled: true, focused: true })).toBe(true);
        expect(output.value).toBe(0.42);
        expect(gate.getGain()).toBe(1);
        expect(output.writes).toEqual([0, 0.42]);
    });

    it("reports no move for a re-decide that changes nothing", () => {
        const output = fakeOutput();
        const gate = createFocusMuteController({ output: () => output });

        expect(gate.update({ enabled: true, focused: false })).toBe(true);
        // The shape the host calls on every preference change: same window, same preference.
        expect(gate.update({ enabled: true, focused: false })).toBe(false);
        expect(gate.getGain()).toBe(0);
    });

    it("re-asserts over an output something else re-opened, and keeps the new volume to restore", () => {
        // The engine writes the master volume onto this same output whenever `globalVolume` moves,
        // which re-opens it underneath a shut gate. The gate has to shut it again AND take the new
        // value as what to restore, or the player's change would be undone when they came back.
        const output = fakeOutput(0.8);
        const gate = createFocusMuteController({ output: () => output });

        gate.update({ enabled: true, focused: false });
        expect(output.value).toBe(0);

        output.setGlobalVolume(0.3);
        gate.update({ enabled: true, focused: false });
        expect(output.value).toBe(0);

        gate.update({ enabled: true, focused: true });
        expect(output.value).toBe(0.3);
    });

    it("turning the preference off while away brings the sound straight back", () => {
        const output = fakeOutput(0.5);
        const gate = createFocusMuteController({ output: () => output });

        gate.update({ enabled: true, focused: false });
        expect(output.value).toBe(0);

        expect(gate.update({ enabled: false, focused: false })).toBe(true);
        expect(output.value).toBe(0.5);
    });

    it("never leaves the output at zero across a teardown", () => {
        // The engine reads its output back into the master volume preference when its player
        // mounts. A zero left here would be taken for the volume the player chose, and saved.
        const output = fakeOutput(0.6);
        const gate = createFocusMuteController({ output: () => output });

        gate.update({ enabled: true, focused: false });
        expect(gate.release()).toBe(true);
        expect(output.value).toBe(0.6);
        expect(gate.getGain()).toBe(1);

        // Releasing twice is a no-op rather than a second write of a stale capture.
        expect(gate.release()).toBe(false);
        expect(output.writes).toEqual([0, 0.6]);
    });

    it("does nothing at all when there is no engine to reach", () => {
        const gate = createFocusMuteController({ output: () => null });

        expect(gate.update({ enabled: true, focused: false })).toBe(false);
        expect(gate.getGain()).toBe(1);
        expect(gate.release()).toBe(false);
    });
});
