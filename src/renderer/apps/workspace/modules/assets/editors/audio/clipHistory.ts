import { clipLength, type AudioClip } from "./audioClip";

/**
 * Undo/redo for the audio editor, as one reducer over `{past, present, future}`.
 *
 * A single reducer rather than three `useState`s on purpose: the stacks must move together, and
 * updating one from inside another's updater would let React's repeated updater invocations push
 * duplicate snapshots — which for audio means duplicate *tens of megabytes*.
 *
 * Snapshots are whole clips (the edit operations are pure, so there is nothing cheaper to store),
 * which makes the depth limit a memory limit rather than a count: a stereo 44.1 kHz minute is
 * ~21 MB, so a fixed "50 steps" would be several gigabytes on a long clip.
 */

/** Roughly how many samples the undo stack may hold in total (~200 MB of float samples). */
const MAX_HISTORY_SAMPLES = 50_000_000;
/** Never keep more than this many steps, however short the clip. */
const MAX_HISTORY_STEPS = 50;

export interface ClipHistoryState {
    past: AudioClip[];
    present: AudioClip | null;
    future: AudioClip[];
    /** True once an edit has been made that has not been saved out. */
    dirty: boolean;
}

export type ClipHistoryAction =
    | { type: "load"; clip: AudioClip }
    | { type: "edit"; clip: AudioClip }
    | { type: "undo" }
    | { type: "redo" }
    | { type: "saved" };

export const initialClipHistory: ClipHistoryState = { past: [], present: null, future: [], dirty: false };

function clipCost(clip: AudioClip): number {
    return clipLength(clip) * Math.max(1, clip.channels.length);
}

/** Drop the oldest snapshots until the stack fits both budgets. */
function trim(past: AudioClip[]): AudioClip[] {
    let trimmed = past.length > MAX_HISTORY_STEPS ? past.slice(past.length - MAX_HISTORY_STEPS) : past;
    let total = trimmed.reduce((sum, clip) => sum + clipCost(clip), 0);
    while (trimmed.length > 1 && total > MAX_HISTORY_SAMPLES) {
        total -= clipCost(trimmed[0]);
        trimmed = trimmed.slice(1);
    }
    return trimmed;
}

export function clipHistoryReducer(state: ClipHistoryState, action: ClipHistoryAction): ClipHistoryState {
    switch (action.type) {
        case "load":
            return { past: [], present: action.clip, future: [], dirty: false };
        case "edit":
            return {
                past: state.present ? trim([...state.past, state.present]) : state.past,
                present: action.clip,
                future: [],
                dirty: true,
            };
        case "undo": {
            const previous = state.past[state.past.length - 1];
            if (!previous || !state.present) {
                return state;
            }
            return {
                past: state.past.slice(0, -1),
                present: previous,
                future: [state.present, ...state.future],
                dirty: true,
            };
        }
        case "redo": {
            const next = state.future[0];
            if (!next || !state.present) {
                return state;
            }
            return {
                past: trim([...state.past, state.present]),
                present: next,
                future: state.future.slice(1),
                dirty: true,
            };
        }
        case "saved":
            return { ...state, dirty: false };
    }
}
