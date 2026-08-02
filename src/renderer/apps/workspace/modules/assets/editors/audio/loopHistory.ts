import { normalizeAudioClipRegion } from "@shared/types/audio";
import type { AssetAudioLoop, AssetExtras } from "@/lib/workspace/services/assets/types";

/**
 * Undo/redo for the audio preview's in, loop and out points.
 *
 * The preview is read-only over the samples, so the loop region is the *only* authored state it
 * has - which makes this the whole of its history, not a subset of a larger editing history.
 *
 * One reducer over `{past, present, future}` rather than three `useState`s: the stacks have to
 * move together, and updating one from inside another's updater lets React's repeated updater
 * invocations push the same snapshot twice.
 */

/** Undo depth. A snapshot is three numbers, so this is a sanity bound, not a memory one. */
const MAX_HISTORY_STEPS = 100;

/** Which marker a gesture or command is about. */
export type LoopMarker = "in" | "loop" | "out";

/** The three markers in milliseconds; `null` means that one has not been marked. */
export interface LoopPoints {
    inMs: number | null;
    /** Where each repeat returns to. `null` falls back to {@link inMs} - a plain loop. */
    loopStartMs: number | null;
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

export const EMPTY_LOOP: LoopPoints = { inMs: null, loopStartMs: null, outMs: null };

export const initialLoopHistory: LoopHistoryState = { past: [], present: EMPTY_LOOP, future: [] };

export function sameLoop(a: LoopPoints, b: LoopPoints): boolean {
    return a.inMs === b.inMs && a.loopStartMs === b.loopStartMs && a.outMs === b.outMs;
}

export function fromAssetLoop(loop: AssetAudioLoop | undefined): LoopPoints {
    return {
        inMs: loop?.inMs ?? null,
        loopStartMs: loop?.loopStartMs ?? null,
        outMs: loop?.outMs ?? null,
    };
}

/** The marker's own value, so callers do not repeat the three-way branch. */
export function loopPointAt(loop: LoopPoints, marker: LoopMarker): number | null {
    return marker === "in" ? loop.inMs : marker === "loop" ? loop.loopStartMs : loop.outMs;
}

/**
 * The stored region, falling back to the cue-point list that preceded it.
 *
 * Delegates to the shared normalizer rather than reading `extras` itself: the game bundle reduces
 * the same records through the same function, so a clip cannot loop one way in this preview and
 * another way in the running game.
 */
export function fromAssetExtras(extras: AssetExtras | undefined): LoopPoints {
    return fromAssetLoop(normalizeAudioClipRegion(extras) ?? undefined);
}

/** Back to the stored shape, or `undefined` when nothing is marked so the key leaves the record. */
export function toAssetLoop(loop: LoopPoints): AssetAudioLoop | undefined {
    if (loop.inMs === null && loop.loopStartMs === null && loop.outMs === null) {
        return undefined;
    }
    return {
        ...(loop.inMs !== null ? { inMs: loop.inMs } : {}),
        ...(loop.outMs !== null ? { outMs: loop.outMs } : {}),
        ...(loop.loopStartMs !== null ? { loopStartMs: loop.loopStartMs } : {}),
    };
}

/**
 * Mark one marker, dropping any other the new position would put out of order.
 *
 * The three have to read `in <= loop < out`; anything else describes nothing playable. Silently
 * swapping them would move a marker the author did not touch, so the stale ones are cleared
 * instead - that says what happened, and leaves the marker just placed exactly where it was put.
 *
 * The loop point may sit *on* the in point (that is a plain loop, the pre-loop-point behaviour),
 * which is why its comparisons against the in point are the inclusive ones.
 */
export function markPoint(loop: LoopPoints, marker: LoopMarker, timeMs: number): LoopPoints {
    if (marker === "in") {
        return {
            inMs: timeMs,
            loopStartMs: loop.loopStartMs !== null && loop.loopStartMs >= timeMs ? loop.loopStartMs : null,
            outMs: loop.outMs !== null && loop.outMs > timeMs ? loop.outMs : null,
        };
    }
    if (marker === "loop") {
        return {
            inMs: loop.inMs !== null && loop.inMs <= timeMs ? loop.inMs : null,
            loopStartMs: timeMs,
            outMs: loop.outMs !== null && loop.outMs > timeMs ? loop.outMs : null,
        };
    }
    return {
        inMs: loop.inMs !== null && loop.inMs < timeMs ? loop.inMs : null,
        loopStartMs: loop.loopStartMs !== null && loop.loopStartMs < timeMs ? loop.loopStartMs : null,
        outMs: timeMs,
    };
}

export function clearPoint(loop: LoopPoints, marker: LoopMarker): LoopPoints {
    if (marker === "in") {
        return { ...loop, inMs: null };
    }
    return marker === "loop" ? { ...loop, loopStartMs: null } : { ...loop, outMs: null };
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
