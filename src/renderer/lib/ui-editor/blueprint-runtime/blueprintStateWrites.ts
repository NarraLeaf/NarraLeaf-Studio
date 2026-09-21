/**
 * Game state a value binding can read, and the one place a write to any of it is announced.
 *
 * A value binding re-runs its graph when something it read changes - that is the whole promise of
 * binding a prop instead of setting it. For a long time "something it read" meant a widget prop or
 * the two state stores (a surface's and the game's), and nothing else. A binding that showed a
 * variable - `Get Var` of a global counter, a page's own tally, a persistent setting read through a
 * Fn, a saved variable - showed whatever the variable held the first time the page drew, and kept
 * showing it: `Set Var` from an `On Action` changed the variable, the next graph to read it saw the
 * new value, and the text bound to it never moved. Nothing said why. An author had to give up on
 * the binding and `Set Text` from every graph that wrote the variable.
 *
 * So each kind of state is named by one key, the read side records the keys it touched (the locals
 * accessors for blueprint variables, the variable nodes for the other two) and every writer - any
 * graph, on any host, and the story - announces the key it wrote. The value runtime of each surface
 * listens and re-runs only the bindings whose last run read that key.
 *
 * A module-level channel on purpose. Blueprint variables already live in one module-level store for
 * the whole renderer (see `blueprintWidgetLocals`), shared by every host: the global On Action that
 * writes a counter and the page and overlay that show it run on three different hosts, and all three
 * have to meet somewhere that is not any one of them.
 *
 * Comments in English per project convention.
 */

/** The key a blueprint variable is read and written under: its record, and its id in the record. */
export function blueprintVariableStateKey(storeKey: string, variableId: string): string {
    return `var\0${storeKey}\0${variableId}`;
}

/** Every variable in one record - what a record being dropped or replaced as a whole writes. */
export function blueprintVariableRecordStateKey(storeKey: string): string {
    return `var\0${storeKey}\0*`;
}

/** A persistent variable, by the storage key its value is kept under. */
export function persistentStateKey(storageKey: string): string {
    return `persistent\0${storageKey}`;
}

/** Every persistent value at once: the store reloaded or cleared. */
export const EVERY_PERSISTENT_STATE_KEY = "persistent\0*";

/** A saved variable of the running playthrough, by its id. */
export function savedVariableStateKey(variableId: string): string {
    return `saved\0${variableId}`;
}

/** Every saved variable at once: a save loaded, a new game started. */
export const EVERY_SAVED_STATE_KEY = "saved\0*";

/**
 * Whether a write under `written` can have changed what was read under `read`.
 *
 * A key ending in `*` covers every key it is the prefix of, which is how a write that replaces a
 * whole family at once - a save loaded, a store reloaded - reaches everything read out of it without
 * having to list it.
 */
export function stateWriteReaches(read: string, written: string): boolean {
    if (read === written) {
        return true;
    }
    return written.endsWith("*") && read.startsWith(written.slice(0, -1));
}

/**
 * Who wrote, when it matters: the value binding whose own graph made the write.
 *
 * A binding may call a Fn, and a Fn may write a variable the binding also reads. Handing that write
 * back to the binding that made it would re-run it, which would write again - a binding that counts
 * how often it ran would never stop. So a write carries its origin, and a listener leaves its own
 * alone. Every other reader of the key still hears it.
 */
export type BlueprintStateWriteListener = (key: string, origin: unknown) => void;

const listeners = new Set<BlueprintStateWriteListener>();

/** Say that the state under `key` may have changed. */
export function announceBlueprintStateWrite(key: string, origin?: unknown): void {
    for (const listener of [...listeners]) {
        try {
            listener(key, origin);
        } catch (error) {
            // One surface failing to re-read must not keep the write from the others, nor fail the
            // node that wrote.
            console.warn("[blueprintStateWrites] listener failed", error);
        }
    }
}

export function subscribeBlueprintStateWrites(listener: BlueprintStateWriteListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Whether writing `next` over `previous` is worth announcing.
 *
 * Only a primitive written over an equal primitive is not: an object may have been changed in place
 * by whatever handed it over, so the same reference is no evidence of the same contents.
 */
export function isStateWriteNoticeable(previous: unknown, next: unknown): boolean {
    if (Object.is(previous, next)) {
        return next !== null && typeof next === "object";
    }
    return true;
}
