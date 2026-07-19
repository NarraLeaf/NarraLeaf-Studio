import { describe, expect, it } from "vitest";
import {
    canRedoCues,
    canUndoCues,
    cueHistoryReducer,
    initialCueHistory,
    sameCues,
    type CueHistoryState,
} from "./cueHistory";

const cues = (...times: number[]) => times.map(timeMs => ({ timeMs }));

/** Apply a sequence of actions, so the tests read as the user's actual key presses. */
function run(state: CueHistoryState, ...actions: Parameters<typeof cueHistoryReducer>[1][]): CueHistoryState {
    return actions.reduce(cueHistoryReducer, state);
}

describe("sameCues", () => {
    it("compares by value, not identity", () => {
        expect(sameCues(cues(100, 200), cues(100, 200))).toBe(true);
        expect(sameCues(cues(100), cues(200))).toBe(false);
        expect(sameCues(cues(100), cues(100, 200))).toBe(false);
    });

    it("notices a label change at the same time", () => {
        expect(sameCues([{ timeMs: 1, label: "a" }], [{ timeMs: 1, label: "b" }])).toBe(false);
    });
});

describe("cueHistoryReducer", () => {
    it("loads a baseline with nothing to undo", () => {
        const state = run(initialCueHistory, { type: "load", cues: cues(500) });
        expect(state.present).toEqual(cues(500));
        expect(canUndoCues(state)).toBe(false);
        expect(canRedoCues(state)).toBe(false);
    });

    it("walks back and forward through edits", () => {
        const state = run(
            initialCueHistory,
            { type: "load", cues: [] },
            { type: "set", cues: cues(100) },
            { type: "set", cues: cues(100, 200) },
        );
        expect(state.present).toEqual(cues(100, 200));

        const undone = run(state, { type: "undo" });
        expect(undone.present).toEqual(cues(100));

        const twice = run(undone, { type: "undo" });
        expect(twice.present).toEqual([]);
        expect(canUndoCues(twice)).toBe(false);

        expect(run(twice, { type: "redo" }, { type: "redo" }).present).toEqual(cues(100, 200));
    });

    it("ignores a set that changes nothing, so undo never needs a double press", () => {
        const loaded = run(initialCueHistory, { type: "load", cues: cues(100) });
        const same = run(loaded, { type: "set", cues: cues(100) });
        expect(same).toBe(loaded);
        expect(canUndoCues(same)).toBe(false);
    });

    it("drops the redo stack once a new edit branches off it", () => {
        const state = run(
            initialCueHistory,
            { type: "load", cues: [] },
            { type: "set", cues: cues(100) },
            { type: "undo" },
            { type: "set", cues: cues(900) },
        );
        expect(state.present).toEqual(cues(900));
        expect(canRedoCues(state)).toBe(false);
    });

    it("is a no-op at either end of the stack", () => {
        const loaded = run(initialCueHistory, { type: "load", cues: cues(1) });
        expect(run(loaded, { type: "undo" })).toBe(loaded);
        expect(run(loaded, { type: "redo" })).toBe(loaded);
    });

    it("caps the undo depth without disturbing the present", () => {
        let state = run(initialCueHistory, { type: "load", cues: [] });
        for (let i = 1; i <= 150; i++) {
            state = cueHistoryReducer(state, { type: "set", cues: cues(i) });
        }
        expect(state.present).toEqual(cues(150));
        expect(state.past.length).toBe(100);
        // The oldest surviving step is the one 100 edits back, not the original empty baseline.
        expect(state.past[0]).toEqual(cues(50));
    });

    it("a fresh load clears history left over from the previous asset", () => {
        const state = run(
            initialCueHistory,
            { type: "load", cues: [] },
            { type: "set", cues: cues(100) },
            { type: "load", cues: cues(7) },
        );
        expect(state.present).toEqual(cues(7));
        expect(canUndoCues(state)).toBe(false);
        expect(canRedoCues(state)).toBe(false);
    });
});
