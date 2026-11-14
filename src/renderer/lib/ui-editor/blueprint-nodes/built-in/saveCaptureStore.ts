/**
 * Where the running playthrough lives between `Current Game` and whoever it is handed to.
 *
 * In the execution's own `blueprintLocals`, under a key no pin can name - the same place a fetched
 * response body waits, and for the same three reasons. `executeGraph` makes that object per run and
 * drops it when the run ends, so a capture is scoped to one execution chain, unreachable from any
 * other, and freed without a release node or anything for an author to remember. And the *pin*
 * carries an id rather than a whole serialized playthrough, so nothing copies one into a node
 * output, along a data edge, or into a local variable it was wired to by mistake.
 *
 * That lifetime is also the answer to "why can a save screen not read a `run` slot": the capture
 * belongs to the chain that took it. A screen drawn by a later event was never holding it, so the
 * read nodes say so instead of answering as if the slot were empty.
 *
 * Comments in English per project convention.
 */

import { toBlueprintSaveSlot, type BlueprintSaveSlot } from "@shared/types/blueprint/valueTypes";

/**
 * Deliberately not a valid node id, so it cannot collide with the node output values that share
 * this object (`writeBlueprintNodeOutputValues` keys by node id).
 */
const SAVE_CAPTURE_STORE_KEY = "@game/saveCaptures";

/**
 * How many captures one execution may hold.
 *
 * A capture is a whole playthrough, and the shapes that want more than one of them - a loop taking
 * a snapshot per iteration - are shapes that have gone wrong rather than shapes to support. Small
 * enough to bound the memory, generous enough that nothing legitimate meets it.
 */
export const MAX_LIVE_SAVE_CAPTURES = 8;

type SaveCaptureStore = {
    captures: Map<string, unknown>;
    pending: number;
};

let fallbackCaptureSequence = 0;

function newCaptureId(nodeId: string): string {
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}-${++fallbackCaptureSequence}`;
    return `${nodeId}#${id}`;
}

function readStore(blueprintLocals: Record<string, unknown>): SaveCaptureStore {
    const existing = blueprintLocals[SAVE_CAPTURE_STORE_KEY] as SaveCaptureStore | undefined;
    if (existing) {
        return existing;
    }
    const created: SaveCaptureStore = { captures: new Map(), pending: 0 };
    blueprintLocals[SAVE_CAPTURE_STORE_KEY] = created;
    return created;
}

/** How many completed captures this execution is holding. */
export function countLiveSaveCaptures(blueprintLocals: Record<string, unknown>): number {
    return readStore(blueprintLocals).captures.size;
}

export function isSaveCaptureLimitReached(blueprintLocals: Record<string, unknown>): boolean {
    const store = readStore(blueprintLocals);
    return store.captures.size + store.pending >= MAX_LIVE_SAVE_CAPTURES;
}

/** Reserve space before the asynchronous capture begins; release it when the attempt settles. */
export function reserveSaveCapture(blueprintLocals: Record<string, unknown>): (() => void) | null {
    if (isSaveCaptureLimitReached(blueprintLocals)) {
        return null;
    }
    const store = readStore(blueprintLocals);
    store.pending += 1;
    return () => { store.pending -= 1; };
}

/** Take ownership of a serialized run and return a slot unique across executions. */
export function storeSaveCapture(
    blueprintLocals: Record<string, unknown>,
    nodeId: string,
    savedGame: unknown,
): BlueprintSaveSlot {
    const store = readStore(blueprintLocals);
    const id = newCaptureId(nodeId);
    store.captures.set(id, savedGame);
    // Non-null: the id above is always a non-empty string.
    return toBlueprintSaveSlot("run", id)!;
}

/**
 * The run behind a `run` slot, or null when this execution never held it.
 *
 * Null is reachable two ways: a slot minted by a different execution chain, and one from an
 * execution that has since ended. Callers report both as the graph being wired wrong, which is what
 * they are - a capture cannot outlive its own run by design.
 */
export function readSaveCapture(
    blueprintLocals: Record<string, unknown>,
    slot: BlueprintSaveSlot,
): unknown | null {
    if (slot.source !== "run") {
        return null;
    }
    return readStore(blueprintLocals).captures.get(slot.id) ?? null;
}
