import { describe, expect, it } from "vitest";
import { clipHistoryReducer, initialClipHistory, type ClipHistoryState } from "./clipHistory";
import type { AudioClip } from "./audioClip";

function clipOf(length: number, channels = 1): AudioClip {
    return { sampleRate: 44100, channels: Array.from({ length: channels }, () => new Float32Array(length)) };
}

/**
 * A clip that only *claims* a length. The reducer measures clips through `channels[0].length`
 * and never reads samples, so the memory-budget cases can use minutes-long clips without
 * allocating the hundreds of megabytes that would actually represent them.
 */
function hugeClip(length: number, channels = 1): AudioClip {
    return {
        sampleRate: 44100,
        channels: Array.from({ length: channels }, () => ({ length }) as unknown as Float32Array),
    };
}

function loadedWith(clip: AudioClip): ClipHistoryState {
    return clipHistoryReducer(initialClipHistory, { type: "load", clip });
}

describe("clipHistoryReducer", () => {
    it("loading resets both stacks and the dirty flag", () => {
        const dirty = clipHistoryReducer(loadedWith(clipOf(10)), { type: "edit", clip: clipOf(5) });
        const reloaded = clipHistoryReducer(dirty, { type: "load", clip: clipOf(20) });
        expect(reloaded.past).toEqual([]);
        expect(reloaded.future).toEqual([]);
        expect(reloaded.dirty).toBe(false);
    });

    it("editing pushes the previous clip and clears the redo stack", () => {
        const first = loadedWith(clipOf(10));
        const second = clipHistoryReducer(first, { type: "edit", clip: clipOf(20) });
        const undone = clipHistoryReducer(second, { type: "undo" });
        const branched = clipHistoryReducer(undone, { type: "edit", clip: clipOf(30) });
        expect(branched.future).toEqual([]);
        expect(branched.present?.channels[0].length).toBe(30);
    });

    it("round-trips undo and redo", () => {
        const state = clipHistoryReducer(loadedWith(clipOf(10)), { type: "edit", clip: clipOf(20) });
        const undone = clipHistoryReducer(state, { type: "undo" });
        expect(undone.present?.channels[0].length).toBe(10);
        const redone = clipHistoryReducer(undone, { type: "redo" });
        expect(redone.present?.channels[0].length).toBe(20);
        expect(redone.past).toHaveLength(1);
    });

    it("undo and redo at the ends of the stack are no-ops", () => {
        const state = loadedWith(clipOf(10));
        expect(clipHistoryReducer(state, { type: "undo" })).toBe(state);
        expect(clipHistoryReducer(state, { type: "redo" })).toBe(state);
    });

    it("keeps at most 50 steps for short clips", () => {
        let state = loadedWith(clipOf(1));
        for (let i = 0; i < 80; i++) {
            state = clipHistoryReducer(state, { type: "edit", clip: clipOf(1) });
        }
        expect(state.past).toHaveLength(50);
    });

    it("drops old snapshots when long clips exceed the memory budget", () => {
        // ~30M samples each: two fit in the 50M budget, three do not.
        let state = loadedWith(hugeClip(30_000_000));
        state = clipHistoryReducer(state, { type: "edit", clip: hugeClip(30_000_000) });
        state = clipHistoryReducer(state, { type: "edit", clip: hugeClip(30_000_000) });
        expect(state.past).toHaveLength(1);
    });

    it("saving only clears the dirty flag", () => {
        const edited = clipHistoryReducer(loadedWith(clipOf(10)), { type: "edit", clip: clipOf(20) });
        const saved = clipHistoryReducer(edited, { type: "saved" });
        expect(saved.dirty).toBe(false);
        expect(saved.past).toHaveLength(1);
        expect(saved.present).toBe(edited.present);
    });
});
