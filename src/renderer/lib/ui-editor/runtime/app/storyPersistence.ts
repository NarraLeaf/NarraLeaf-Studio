import type { StoryLiteralValue } from "@shared/types/story";
import type { StoryPersistenceBridge } from "../game/storyCompiler";

/** The scope bridge, as much of it as a story boot needs: the store read, and the cache it fills. */
export type StoryPersistenceSource = {
    reloadPersistenceSnapshot(): Promise<void>;
    persistenceGet(storageKey: string): unknown;
    persistenceSet(storageKey: string, value: unknown): void | Promise<void>;
};

export type StoryPersistence = {
    /** The reader the stage walk poses a row-precise launch with. */
    readPersistent: (storageKey: string) => StoryLiteralValue | null | undefined;
    /** The port the compiled story reads and writes persistent values through, while it runs. */
    port: StoryPersistenceBridge;
};

/**
 * Everything a story boot reads persistent values through - opened only once the store has been read.
 *
 * Both halves of a boot ask the same question of the same scope, and both can only ask it
 * synchronously: the walk that poses a row-precise launch is a synchronous walk, and a persistent
 * condition inside the running story is evaluated between two frames. The only synchronous reader
 * there is answers from the session cache, and that cache is filled by a reload the bridge starts
 * when its adapter is installed and nobody waits for - one IPC round trip to the profile that holds
 * the values, against a boot that is a render away from the same moment.
 *
 * Losing that race cost the pre-pose the author's stored value: the walk settled the stage on each
 * persistent variable's declared default while the story it was posing for went on to read the
 * store, so one launch showed one arm of a condition and played the other, and changing the stored
 * value moved nothing on screen. The running story reads through the same cache and had the same
 * race; it happened to win, which is not a property anything guarantees.
 *
 * So the store is read once, here, before either half exists. One value, one cache, one source -
 * the readers below are the same lookups as before, only guaranteed to have something to look up.
 *
 * A store that cannot be read leaves both halves on declared defaults, which is where they stood
 * before either could read the store at all. That is worth a pre-pose one branch off; it is not
 * worth refusing to launch over.
 */
export async function openStoryPersistence(source: StoryPersistenceSource): Promise<StoryPersistence> {
    try {
        await source.reloadPersistenceSnapshot();
    } catch {
        // Reported nowhere on purpose: the bridge's own reload swallows the same failure, and a
        // second voice saying it here would say it once per launch.
    }
    return {
        readPersistent: storageKey => source.persistenceGet(storageKey) as StoryLiteralValue | null | undefined,
        port: {
            get: storageKey => source.persistenceGet(storageKey),
            set: (storageKey, value) => source.persistenceSet(storageKey, value),
        },
    };
}
