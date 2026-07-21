import type { AssetAudioLoop, AssetExtras } from "@/lib/workspace/services/assets/types";

/**
 * Undo/redo for the audio preview's in and out points.
 *
 * The preview is read-only over the samples, so the loop region is the *only* authored state it
 * has - which makes this the whole of its history, not a subset of a larger editing history.
 *
 * One reducer over `{past, present, future}` rather than three `useState`s: the stacks have to
 * move together, and updating one from inside another's updater lets React's repeated updater
 * invocations push the same snapshot twice.
 */

/** Undo depth. A snapshot is two numbers, so this is a sanity bound, not a memory one. */
const MAX_HISTORY_STEPS = 100;

/** In and out in milliseconds; `null` means that end has not been marked. */
export interface LoopPoints {
    inMs: number | null;
    outMs: number | null;
}

export interface LoopHistoryState {
    past: LoopPoints[];
    present: LoopPoints;
    future: LoopPoints[];
}

export type LoopHistoryAction =
    /** Adopt the asset's stored region as a fresh baseline - clears both stacks. */
    | { type: "load"; loop: LoopPoints }
    | { type: "set"; loop: LoopPoints }
    | { type: "undo" }
    | { type: "redo" };

export const EMPTY_LOOP: LoopPoints = { inMs: null, outMs: null };

export const initialLoopHistory: LoopHistoryState = { past: [], present: EMPTY_LOOP, future: [] };

export function sameLoop(a: LoopPoints, b: LoopPoints): boolean {
    return a.inMs === b.inMs && a.outMs === b.outMs;
}

export function fromAssetLoop(loop: AssetAudioLoop | undefined): LoopPoints {
    return { inMs: loop?.inMs ?? null, outMs: loop?.outMs ?? null };
}

/**
 * The stored region, falling back to the cue-point list that preceded it.
 *
 * Those markers existed to record exactly this - "a BGM's loop in/out points" - so the earliest
 * two, in time order, are the in and the out. Reading them keeps records written against the old
 * shape from opening blank and quietly losing what the author marked.
 */
export function fromAssetExtras(extras: AssetExtras | undefined): LoopPoints {
    if (extras?.audioLoop) {
        return fromAssetLoop(extras.audioLoop);
    }
    const legacy = [...(extras?.cuePoints ?? [])].sort((a, b) => a.timeMs - b.timeMs);
    return { inMs: legacy[0]?.timeMs ?? null, outMs: legacy[1]?.timeMs ?? null };
}

/** Back to the stored shape, or `undefined` when nothing is marked so the key leaves the record. */
export function toAssetLoop(loop: LoopPoints): AssetAudioLoop | undefined {
    if (loop.inMs === null && loop.outMs === null) {
        return undefined;
    }
    return {
        ...(loop.inMs !== null ? { inMs: loop.inMs } : {}),
        ...(loop.outMs !== null ? { outMs: loop.outMs } : {}),
    };
}

/**
 * Mark one end, dropping the other if that would invert the region.
 *
 * An out point at or before the in point describes nothing playable, and silently swapping the two
 * would move a point the author did not touch. Clearing the stale end says what happened and
 * leaves the marked end exactly where it was put.
 */
export function markPoint(loop: LoopPoints, end: "in" | "out", timeMs: number): LoopPoints {
    if (end === "in") {
        const keepOut = loop.outMs !== null && loop.outMs > timeMs;
        return { inMs: timeMs, outMs: keepOut ? loop.outMs : null };
    }
    const keepIn = loop.inMs !== null && loop.inMs < timeMs;
    return { inMs: keepIn ? loop.inMs : null, outMs: timeMs };
}

export function clearPoint(loop: LoopPoints, end: "in" | "out"): LoopPoints {
    return end === "in" ? { ...loop, inMs: null } : { ...loop, outMs: null };
}

export function loopHistoryReducer(state: LoopHistoryState, action: LoopHistoryAction): LoopHistoryState {
    switch (action.type) {
        case "load":
            return { past: [], present: action.loop, future: [] };
        case "set": {
            // A set that changes nothing must not push a step, or undo starts needing repeated
            // presses to get anywhere.
            if (sameLoop(state.present, action.loop)) {
                return state;
            }
            const past = [...state.past, state.present];
            return {
                past: past.length > MAX_HISTORY_STEPS ? past.slice(past.length - MAX_HISTORY_STEPS) : past,
                present: action.loop,
                future: [],
            };
        }
        case "undo": {
            const previous = state.past[state.past.length - 1];
            if (!previous) {
                return state;
            }
            return {
                past: state.past.slice(0, -1),
                present: previous,
                future: [state.present, ...state.future],
            };
        }
        case "redo": {
            const next = state.future[0];
            if (!next) {
                return state;
            }
            return {
                past: [...state.past, state.present],
                present: next,
                future: state.future.slice(1),
            };
        }
    }
}

export function canUndoLoop(state: LoopHistoryState): boolean {
    return state.past.length > 0;
}

export function canRedoLoop(state: LoopHistoryState): boolean {
    return state.future.length > 0;
}
