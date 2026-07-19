import type { AssetCuePoint } from "@/lib/workspace/services/assets/types";

/**
 * Undo/redo for the audio preview's cue points.
 *
 * The preview is read-only over the samples, so cue points are the *only* authored state it has -
 * which makes this the whole of its history, not a subset of a larger editing history.
 *
 * One reducer over `{past, present, future}` rather than three `useState`s: the stacks have to
 * move together, and updating one from inside another's updater lets React's repeated updater
 * invocations push the same snapshot twice.
 *
 * Snapshots are whole cue arrays. A cue is two numbers, so unlike a sample-level history this
 * needs no memory budget - a plain step cap is enough.
 */

/** Undo depth. Cue edits are cheap; this is a sanity bound, not a memory one. */
const MAX_HISTORY_STEPS = 100;

export interface CueHistoryState {
    past: AssetCuePoint[][];
    present: AssetCuePoint[];
    future: AssetCuePoint[][];
}

export type CueHistoryAction =
    /** Adopt the asset's stored cues as a fresh baseline - clears both stacks. */
    | { type: "load"; cues: AssetCuePoint[] }
    | { type: "set"; cues: AssetCuePoint[] }
    | { type: "undo" }
    | { type: "redo" };

export const initialCueHistory: CueHistoryState = { past: [], present: [], future: [] };

/** Cue arrays are value objects here; identity would make every re-render look like an edit. */
export function sameCues(a: AssetCuePoint[], b: AssetCuePoint[]): boolean {
    return a.length === b.length && a.every((cue, i) => cue.timeMs === b[i].timeMs && cue.label === b[i].label);
}

export function cueHistoryReducer(state: CueHistoryState, action: CueHistoryAction): CueHistoryState {
    switch (action.type) {
        case "load":
            return { past: [], present: action.cues, future: [] };
        case "set": {
            // A set that changes nothing must not push a step, or undo starts needing repeated
            // presses to get anywhere.
            if (sameCues(state.present, action.cues)) {
                return state;
            }
            const past = [...state.past, state.present];
            return {
                past: past.length > MAX_HISTORY_STEPS ? past.slice(past.length - MAX_HISTORY_STEPS) : past,
                present: action.cues,
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

export function canUndoCues(state: CueHistoryState): boolean {
    return state.past.length > 0;
}

export function canRedoCues(state: CueHistoryState): boolean {
    return state.future.length > 0;
}
