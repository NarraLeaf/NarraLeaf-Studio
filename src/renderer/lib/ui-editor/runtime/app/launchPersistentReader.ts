import type { StoryLiteralValue } from "@shared/types/story";

/** The two halves of the scope bridge a launch needs: the store read, and the cache it fills. */
export type LaunchPersistenceSource = {
    reloadPersistenceSnapshot(): Promise<void>;
    persistenceGet(storageKey: string): unknown;
};

/**
 * The persistent reader a row-precise launch poses the stage with - after the store has been read.
 *
 * The stage walk is synchronous, so it can only be handed a synchronous reader, and the only
 * synchronous reader there is answers from the session cache. That cache is filled by a reload the
 * bridge starts when its adapter is installed and nobody waits for: one IPC round trip to the
 * profile that holds the values. A launch is a render away from the same moment, so it wins that
 * race every time, and the walk then decided every persistent condition from the variable's
 * declared default while the story it was posing for went on to read the stored value - the same
 * launch showing one arm of a condition and playing the other, with the author's own stored choice
 * changing nothing about what appeared in front of them.
 *
 * So the store is read first, into the cache everything else already reads. One value, one source:
 * the reader below is the same lookup the compiled story performs, only guaranteed to have
 * something to look up.
 *
 * A store that cannot be read leaves the walk on declared defaults, which is where it stood before
 * it could read the store at all. That is worth a pre-pose one branch off; it is not worth refusing
 * to launch over.
 */
export async function openLaunchPersistentReader(
    source: LaunchPersistenceSource,
): Promise<(storageKey: string) => StoryLiteralValue | null | undefined> {
    try {
        await source.reloadPersistenceSnapshot();
    } catch {
        // Reported nowhere on purpose: the bridge's own reload swallows the same failure, and a
        // second voice saying it here would say it once per launch.
    }
    return storageKey => source.persistenceGet(storageKey) as StoryLiteralValue | null | undefined;
}
