/**
 * "The installed dictionaries just changed", within the Settings window.
 *
 * The language row and the dictionary panel are two rows of the same page and they read the same
 * list, so a download made in one has to reach the other. Nothing is stored under a settings key for
 * either — the dictionaries are files in a cache — so there is no global-state broadcast to follow,
 * and a window does not lose focus to itself.
 */
const listeners = new Set<() => void>();

/** Subscribe; the returned function unsubscribes. */
export function onDictionariesChanged(handler: () => void): () => void {
    listeners.add(handler);
    return () => {
        listeners.delete(handler);
    };
}

/** Announce a download or a removal that has already finished. */
export function notifyDictionariesChanged(): void {
    for (const handler of [...listeners]) {
        handler();
    }
}
