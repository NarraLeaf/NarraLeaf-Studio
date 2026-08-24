import { describe, expect, it } from "vitest";
import { createDisplayAwakeController } from "./displayAwake";

function fixture(initial: { auto: boolean; onScreen: boolean }) {
    const state = { ...initial };
    const calls: boolean[] = [];
    const controller = createDisplayAwakeController({
        isAutoForwardOn: () => state.auto,
        isStoryOnScreen: () => state.onScreen,
        setAwake: awake => { calls.push(awake); },
    });
    return { controller, state, calls };
}

describe("createDisplayAwakeController", () => {
    it("holds the display only while auto-forward is on and the story is on screen", () => {
        const { controller, state, calls } = fixture({ auto: false, onScreen: true });
        controller.sync();
        expect(calls).toEqual([]);

        state.auto = true;
        controller.sync();
        expect(calls).toEqual([true]);

        state.onScreen = false;
        controller.sync();
        expect(calls).toEqual([true, false]);
    });

    it("lets a title screen with auto-forward left on sleep", () => {
        const { controller, calls } = fixture({ auto: true, onScreen: false });
        controller.sync();
        expect(calls).toEqual([]);
    });

    it("says nothing when nothing changed", () => {
        const { controller, calls } = fixture({ auto: true, onScreen: true });
        controller.sync();
        controller.sync();
        controller.sync();
        expect(calls).toEqual([true]);
    });

    it("releases on stop, once", () => {
        const { controller, calls } = fixture({ auto: true, onScreen: true });
        controller.sync();
        controller.stop();
        controller.stop();
        expect(calls).toEqual([true, false]);
    });

    it("has nothing to release when it never held", () => {
        const { controller, calls } = fixture({ auto: false, onScreen: false });
        controller.sync();
        controller.stop();
        expect(calls).toEqual([]);
    });
});
