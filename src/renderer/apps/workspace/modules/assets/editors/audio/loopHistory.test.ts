import { describe, expect, it } from "vitest";
import {
    canRedoLoop,
    canUndoLoop,
    clearPoint,
    EMPTY_LOOP,
    fromAssetExtras,
    fromAssetLoop,
    initialLoopHistory,
    loopHistoryReducer,
    markPoint,
    sameLoop,
    toAssetLoop,
    type LoopHistoryAction,
    type LoopHistoryState,
} from "./loopHistory";

const loop = (inMs: number | null, outMs: number | null) => ({ inMs, outMs });

function run(state: LoopHistoryState, ...actions: LoopHistoryAction[]): LoopHistoryState {
    return actions.reduce(loopHistoryReducer, state);
}

describe("markPoint", () => {
    it("marks each end independently", () => {
        expect(markPoint(EMPTY_LOOP, "in", 500)).toEqual(loop(500, null));
        expect(markPoint(EMPTY_LOOP, "out", 900)).toEqual(loop(null, 900));
        expect(markPoint(loop(100, null), "out", 900)).toEqual(loop(100, 900));
    });

    it("drops the out point when a new in point would sit past it", () => {
        expect(markPoint(loop(100, 400), "in", 700)).toEqual(loop(700, null));
    });

    it("drops the in point when a new out point would sit before it", () => {
        expect(markPoint(loop(600, 900), "out", 300)).toEqual(loop(null, 300));
    });

    it("treats a point landing exactly on the other end as inverted, not as an empty region", () => {
        expect(markPoint(loop(100, 400), "in", 400)).toEqual(loop(400, null));
        expect(markPoint(loop(100, 400), "out", 100)).toEqual(loop(null, 100));
    });

    it("keeps the other end when the region stays valid", () => {
        expect(markPoint(loop(100, 900), "in", 200)).toEqual(loop(200, 900));
        expect(markPoint(loop(100, 900), "out", 800)).toEqual(loop(100, 800));
    });
});

describe("clearPoint", () => {
    it("clears one end and leaves the other", () => {
        expect(clearPoint(loop(100, 900), "in")).toEqual(loop(null, 900));
        expect(clearPoint(loop(100, 900), "out")).toEqual(loop(100, null));
    });
});

describe("asset shape", () => {
    it("round-trips through the stored record", () => {
        expect(fromAssetLoop(undefined)).toEqual(EMPTY_LOOP);
        expect(fromAssetLoop({ inMs: 10, outMs: 20 })).toEqual(loop(10, 20));
        expect(fromAssetLoop({ inMs: 10 })).toEqual(loop(10, null));
        expect(toAssetLoop(loop(10, 20))).toEqual({ inMs: 10, outMs: 20 });
        expect(toAssetLoop(loop(10, null))).toEqual({ inMs: 10 });
    });

    it("stores nothing at all when neither end is marked, so the key leaves the record", () => {
        expect(toAssetLoop(EMPTY_LOOP)).toBeUndefined();
    });

    it("keeps a zero in point rather than treating it as absent", () => {
        expect(toAssetLoop(loop(0, 500))).toEqual({ inMs: 0, outMs: 500 });
        expect(fromAssetLoop({ inMs: 0 })).toEqual(loop(0, null));
    });
});

describe("fromAssetExtras", () => {
    it("prefers the current shape", () => {
        expect(fromAssetExtras({ audioLoop: { inMs: 1, outMs: 2 }, cuePoints: [{ timeMs: 999 }] })).toEqual(loop(1, 2));
    });

    it("reads the superseded cue list as in/out, earliest first", () => {
        expect(fromAssetExtras({ cuePoints: [{ timeMs: 800 }, { timeMs: 200 }] })).toEqual(loop(200, 800));
    });

    it("takes a lone cue point as the in point rather than losing it", () => {
        expect(fromAssetExtras({ cuePoints: [{ timeMs: 263875 }] })).toEqual(loop(263875, null));
    });

    it("ignores cue points beyond the first two", () => {
        expect(fromAssetExtras({ cuePoints: [{ timeMs: 1 }, { timeMs: 2 }, { timeMs: 3 }] })).toEqual(loop(1, 2));
    });

    it("is empty when there is nothing stored at all", () => {
        expect(fromAssetExtras(undefined)).toEqual(EMPTY_LOOP);
        expect(fromAssetExtras({})).toEqual(EMPTY_LOOP);
    });
});

describe("sameLoop", () => {
    it("compares both ends by value", () => {
        expect(sameLoop(loop(1, 2), loop(1, 2))).toBe(true);
        expect(sameLoop(loop(1, 2), loop(1, 3))).toBe(false);
        expect(sameLoop(loop(null, 2), loop(1, 2))).toBe(false);
    });
});

describe("loopHistoryReducer", () => {
    it("loads a baseline with nothing to undo", () => {
        const state = run(initialLoopHistory, { type: "load", loop: loop(100, 900) });
        expect(state.present).toEqual(loop(100, 900));
        expect(canUndoLoop(state)).toBe(false);
        expect(canRedoLoop(state)).toBe(false);
    });

    it("walks back and forward through marks", () => {
        const state = run(
            initialLoopHistory,
            { type: "load", loop: EMPTY_LOOP },
            { type: "set", loop: loop(100, null) },
            { type: "set", loop: loop(100, 900) },
        );
        expect(run(state, { type: "undo" }).present).toEqual(loop(100, null));
        expect(run(state, { type: "undo" }, { type: "undo" }).present).toEqual(EMPTY_LOOP);
        expect(run(state, { type: "undo" }, { type: "redo" }).present).toEqual(loop(100, 900));
    });

    it("ignores a set that changes nothing, so undo never needs a double press", () => {
        const loaded = run(initialLoopHistory, { type: "load", loop: loop(1, 2) });
        expect(run(loaded, { type: "set", loop: loop(1, 2) })).toBe(loaded);
    });

    it("drops the redo stack once a new mark branches off it", () => {
        const state = run(
            initialLoopHistory,
            { type: "load", loop: EMPTY_LOOP },
            { type: "set", loop: loop(100, null) },
            { type: "undo" },
            { type: "set", loop: loop(900, null) },
        );
        expect(state.present).toEqual(loop(900, null));
        expect(canRedoLoop(state)).toBe(false);
    });

    it("is a no-op at either end of the stack", () => {
        const loaded = run(initialLoopHistory, { type: "load", loop: loop(1, 2) });
        expect(run(loaded, { type: "undo" })).toBe(loaded);
        expect(run(loaded, { type: "redo" })).toBe(loaded);
    });

    it("undoes the cleared end that marking an inverted region took away", () => {
        const state = run(
            initialLoopHistory,
            { type: "load", loop: loop(100, 400) },
            { type: "set", loop: markPoint(loop(100, 400), "in", 700) },
        );
        expect(state.present).toEqual(loop(700, null));
        expect(run(state, { type: "undo" }).present).toEqual(loop(100, 400));
    });

    it("a fresh load clears history left over from the previous asset", () => {
        const state = run(
            initialLoopHistory,
            { type: "load", loop: EMPTY_LOOP },
            { type: "set", loop: loop(100, null) },
            { type: "load", loop: loop(7, 9) },
        );
        expect(state.present).toEqual(loop(7, 9));
        expect(canUndoLoop(state)).toBe(false);
    });

    it("caps the undo depth without disturbing the present", () => {
        let state = run(initialLoopHistory, { type: "load", loop: EMPTY_LOOP });
        for (let i = 1; i <= 150; i++) {
            state = loopHistoryReducer(state, { type: "set", loop: loop(i, null) });
        }
        expect(state.present).toEqual(loop(150, null));
        expect(state.past.length).toBe(100);
        expect(state.past[0]).toEqual(loop(50, null));
    });
});
