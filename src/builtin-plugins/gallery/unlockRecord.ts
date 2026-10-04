/**
 * The player's unlock record, read and changed one operation at a time.
 *
 * Two writers change it in a running game: the runtime entry, collecting what the player reaches,
 * hears and is spoken to, and the lock/unlock nodes in the author's graphs. Each change reads the
 * whole record, edits it and writes it back, and plugin storage is asynchronous on both ends. Two
 * changes that overlapped - a scene whose entry graph unlocks a CG while reaching that scene collects
 * a recollection - could both read the record before either wrote, and the second write then carried
 * a copy without the first one's unlock. So every operation on one store waits for the one before
 * it, reads included: a read queued behind a change sees that change.
 *
 * Keyed by the store object. The runtime loader hands `setup` and every node the same `game`, so the
 * collector and the nodes share one queue; a different store - another game, a test - gets its own.
 */

import { RUNTIME_UNLOCKED_KEY, readUnlockedVariantIds, type GalleryArtwork } from "./catalog";

/** The slice of the plugin's `store` capability the record needs. */
export type GalleryUnlockStore = {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
};

const queues = new WeakMap<GalleryUnlockStore, Promise<unknown>>();

/** Run `task` once every operation already queued on `store` has finished, failed ones included. */
function enqueue<T>(store: GalleryUnlockStore, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(store) ?? Promise.resolve();
    const run = previous.then(task, task);
    // The queue carries on past a failure; the caller of the failed operation still sees it.
    queues.set(store, run.catch(() => undefined));
    return run;
}

function sameIds(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) {
        return false;
    }
    for (const id of a) {
        if (!b.has(id)) {
            return false;
        }
    }
    return true;
}

/** The unlocked variant ids, after every change queued before this read. */
export function readUnlockRecord(store: GalleryUnlockStore, artworks: GalleryArtwork[]): Promise<Set<string>> {
    return enqueue(store, async () => readUnlockedVariantIds(await store.get(RUNTIME_UNLOCKED_KEY), artworks));
}

/**
 * Change the record in place: `change` receives the current set and edits it. Written only when the
 * set moved, because the automatic signals repeat on every remount and replay. Resolves to whether
 * anything was written.
 */
export function updateUnlockRecord(
    store: GalleryUnlockStore,
    artworks: GalleryArtwork[],
    change: (unlocked: Set<string>) => void,
): Promise<boolean> {
    return enqueue(store, async () => {
        const before = readUnlockedVariantIds(await store.get(RUNTIME_UNLOCKED_KEY), artworks);
        const after = new Set(before);
        change(after);
        if (sameIds(before, after)) {
            return false;
        }
        await store.set(RUNTIME_UNLOCKED_KEY, Array.from(after));
        return true;
    });
}

/** Replace the whole record - unlock everything, or clear it - in turn with every other change. */
export function replaceUnlockRecord(store: GalleryUnlockStore, ids: string[]): Promise<void> {
    return enqueue(store, () => store.set(RUNTIME_UNLOCKED_KEY, ids));
}
