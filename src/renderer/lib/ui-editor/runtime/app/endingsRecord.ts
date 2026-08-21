/**
 * The unlock record behind the endings a player has reached.
 *
 * A set of `ending` row ids in project persistence - outside every save file, so an endings screen
 * says what this player has ever seen rather than what the save they are currently in has seen. The
 * argument for that domain, and against the save-scoped one the visited record uses, is written
 * where the key is (`BLUEPRINT_ENDINGS_PERSISTENCE_KEY`).
 *
 * Deliberately free of React and of the game: everything here takes a persistence pair, so the same
 * functions serve a running story marking an ending, a Page asking whether one is unlocked before
 * any game has started, and a "reset progress" control wiping the lot.
 *
 * Comments in English per project convention.
 */

import { BLUEPRINT_ENDINGS_PERSISTENCE_KEY } from "@shared/types/blueprint/hostApi";

export const ENDINGS_PERSISTENCE_KEY = BLUEPRINT_ENDINGS_PERSISTENCE_KEY;

/**
 * The persistence pair this module needs.
 *
 * `set` is the store-writing setter, which is the only one there is (see
 * `persistenceDurability.test.ts`): a record that lived only in the session map would answer every
 * question correctly until the player relaunched, which is exactly the shape of the defect that
 * pair of functions was collapsed into one to end.
 */
export type EndingsPersistence = {
    getAsync: (key: string) => Promise<unknown>;
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void | Promise<void>;
};

/** Strings only, deduped, order preserved: the store holds whatever was last written to it. */
export function normalizeEndingIds(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: string[] = [];
    for (const entry of raw) {
        if (typeof entry === "string" && entry && !out.includes(entry)) {
            out.push(entry);
        }
    }
    return out;
}

/** The reached ending ids as the store currently holds them, read from the session map. */
export function readReachedEndings(persistence: Pick<EndingsPersistence, "get">): string[] {
    return normalizeEndingIds(persistence.get(ENDINGS_PERSISTENCE_KEY));
}

/**
 * Whether one ending has been reached. An empty id is "not reached", never an error - the same
 * bargain every other id-keyed reader in the runtime makes, so a half-wired gallery row stays locked
 * instead of taking the page down.
 */
export function isEndingReached(persistence: Pick<EndingsPersistence, "get">, endingId: string): boolean {
    return Boolean(endingId) && readReachedEndings(persistence).includes(endingId);
}

/**
 * Record one ending, durably.
 *
 * Reads through `getAsync` rather than off the session map: the first ending of a session can be
 * reached before anything else has touched the key, and a write built on an empty map would drop
 * every ending an earlier playthrough recorded. Already-present ids write nothing at all, which
 * keeps a replayed ending from rewriting the file on every pass.
 */
export async function markEndingReached(
    persistence: EndingsPersistence,
    endingId: string,
): Promise<void> {
    if (!endingId) {
        return;
    }
    const current = normalizeEndingIds(await persistence.getAsync(ENDINGS_PERSISTENCE_KEY));
    if (current.includes(endingId)) {
        return;
    }
    await persistence.set(ENDINGS_PERSISTENCE_KEY, [...current, endingId]);
}

/**
 * Forget one ending, durably. The exact inverse of {@link markEndingReached}, and async for the
 * same reason: the surviving ids have to be read through `getAsync` before they can be written
 * back, or a wipe built on a cold session map would take every other unlock with it.
 *
 * An id that was never recorded writes nothing, so a debug menu re-running the same node does not
 * touch the file on every press.
 */
export async function forgetEndingReached(
    persistence: EndingsPersistence,
    endingId: string,
): Promise<void> {
    if (!endingId) {
        return;
    }
    const current = normalizeEndingIds(await persistence.getAsync(ENDINGS_PERSISTENCE_KEY));
    if (!current.includes(endingId)) {
        return;
    }
    await persistence.set(ENDINGS_PERSISTENCE_KEY, current.filter(id => id !== endingId));
}

/** Wipe the record. What `Clear Endings` does, and what a "reset progress" control calls. */
export async function clearReachedEndings(persistence: Pick<EndingsPersistence, "set">): Promise<void> {
    await persistence.set(ENDINGS_PERSISTENCE_KEY, []);
}
