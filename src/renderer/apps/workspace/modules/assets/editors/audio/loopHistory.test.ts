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
    loopPointAt,
    markPoint,
    sameLoop,
    toAssetLoop,
    type LoopHistoryAction,
    type LoopHistoryState,
    type LoopPoints,
} from "./loopHistory";

const loop = (inMs: number | null, outMs: number | null, loopStartMs: number | null = null): LoopPoints => ({
    inMs,
    loopStartMs,
    outMs,
});

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

describe("markPoint, the loop point", () => {
    it("marks it on its own, and moves it rather than adding a second one", () => {
        expect(markPoint(EMPTY_LOOP, "loop", 500)).toEqual(loop(null, null, 500));
        expect(markPoint(loop(null, null, 500), "loop", 700)).toEqual(loop(null, null, 700));
    });

    it("sits inside the region and leaves both ends alone", () => {
        expect(markPoint(loop(100, 900), "loop", 400)).toEqual(loop(100, 900, 400));
    });

    it("may sit exactly on the in point - that is a plain loop, not an inverted one", () => {
        expect(markPoint(loop(100, 900), "loop", 100)).toEqual(loop(100, 900, 100));
    });

    it("clears the end it would sit outside, rather than swapping with it", () => {
        expect(markPoint(loop(100, 900), "loop", 50)).toEqual(loop(null, 900, 50));
        expect(markPoint(loop(100, 900), "loop", 900)).toEqual(loop(100, null, 900));
        expect(markPoint(loop(100, 900), "loop", 1200)).toEqual(loop(100, null, 1200));
    });

    it("is cleared by an in point marked past it", () => {
        expect(markPoint(loop(100, 900, 400), "in", 500)).toEqual(loop(500, 900));
        // Marking the in point onto the loop point keeps it: `in <= loop` is legal.
        expect(markPoint(loop(100, 900, 400), "in", 400)).toEqual(loop(400, 900, 400));
    });

    it("is cleared by an out point marked at or before it", () => {
        expect(markPoint(loop(100, 900, 400), "out", 300)).toEqual(loop(100, 300));
        expect(markPoint(loop(100, 900, 400), "out", 400)).toEqual(loop(100, 400));
        expect(markPoint(loop(100, 900, 400), "out", 800)).toEqual(loop(100, 800, 400));
    });
});

describe("clearPoint", () => {
    it("clears one marker and leaves the others", () => {
        expect(clearPoint(loop(100, 900, 400), "in")).toEqual(loop(null, 900, 400));
        expect(clearPoint(loop(100, 900, 400), "out")).toEqual(loop(100, null, 400));
        expect(clearPoint(loop(100, 900, 400), "loop")).toEqual(loop(100, 900));
    });
});

describe("loopPointAt", () => {
    it("reads each marker by name", () => {
        expect(loopPointAt(loop(100, 900, 400), "in")).toBe(100);
        expect(loopPointAt(loop(100, 900, 400), "loop")).toBe(400);
        expect(loopPointAt(loop(100, 900, 400), "out")).toBe(900);
        expect(loopPointAt(EMPTY_LOOP, "loop")).toBeNull();
    });
});

describe("asset shape", () => {
    it("round-trips through the stored record", () => {
        expect(fromAssetLoop(undefined)).toEqual(EMPTY_LOOP);
        expect(fromAssetLoop({ inMs: 10, outMs: 20 })).toEqual(loop(10, 20));
        expect(fromAssetLoop({ inMs: 10 })).toEqual(loop(10, null));
        expect(fromAssetLoop({ inMs: 10, outMs: 20, loopStartMs: 15 })).toEqual(loop(10, 20, 15));
        expect(toAssetLoop(loop(10, 20))).toEqual({ inMs: 10, outMs: 20 });
        expect(toAssetLoop(loop(10, null))).toEqual({ inMs: 10 });
        expect(toAssetLoop(loop(10, 20, 15))).toEqual({ inMs: 10, outMs: 20, loopStartMs: 15 });
    });

    it("leaves loopStartMs off the record entirely when it is unmarked", () => {
        expect(toAssetLoop(loop(10, 20))).not.toHaveProperty("loopStartMs");
    });

    it("stores a lone loop point rather than dropping the whole record", () => {
        expect(toAssetLoop(loop(null, null, 400))).toEqual({ loopStartMs: 400 });
    });

    it("stores nothing at all when no marker is set, so the key leaves the record", () => {
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

    it("reads a stored loop point", () => {
        expect(fromAssetExtras({ audioLoop: { inMs: 0, outMs: 84_000, loopStartMs: 12_000 } })).toEqual(
            loop(0, 84_000, 12_000),
        );
    });

    it("drops a stored loop point the shared normalizer rejects", () => {
        // Past the out point: the region survives as a plain loop rather than gaining a bad one.
        expect(fromAssetExtras({ audioLoop: { inMs: 0, outMs: 84_000, loopStartMs: 90_000 } })).toEqual(loop(0, 84_000));
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
    it("compares all three markers by value", () => {
        expect(sameLoop(loop(1, 2), loop(1, 2))).toBe(true);
        expect(sameLoop(loop(1, 2), loop(1, 3))).toBe(false);
        expect(sameLoop(loop(null, 2), loop(1, 2))).toBe(false);
        expect(sameLoop(loop(1, 3, 2), loop(1, 3, 2))).toBe(true);
        // Without this the loop point would never persist: the editor writes to the asset only
        // when the committed region differs from the one already stored.
        expect(sameLoop(loop(1, 3, 2), loop(1, 3))).toBe(false);
        expect(sameLoop(loop(1, 3, 2), loop(1, 3, 2.5))).toBe(false);
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

    it("undoes a loop point the same way it undoes the two ends", () => {
        const state = run(
            initialLoopHistory,
            { type: "load", loop: loop(0, 84_000) },
            { type: "set", loop: markPoint(loop(0, 84_000), "loop", 12_000) },
        );
        expect(state.present).toEqual(loop(0, 84_000, 12_000));
        expect(run(state, { type: "undo" }).present).toEqual(loop(0, 84_000));
        expect(run(state, { type: "undo" }, { type: "redo" }).present).toEqual(loop(0, 84_000, 12_000));
    });

    it("undoes the end that a loop point marked outside the region took away", () => {
        const state = run(
            initialLoopHistory,
            { type: "load", loop: loop(100, 900) },
            { type: "set", loop: markPoint(loop(100, 900), "loop", 950) },
        );
        expect(state.present).toEqual(loop(100, null, 950));
        expect(run(state, { type: "undo" }).present).toEqual(loop(100, 900));
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
