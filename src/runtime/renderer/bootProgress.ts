/**
 * Where the shipped shell keeps what it knows about its own start-up.
 *
 * A module store rather than component state, and the reason is measurable: the pass that warms the
 * first screen's assets reports after every one of them, and a game with a hundred UI assets would
 * otherwise re-render the whole game app a hundred times during the very seconds this exists to
 * make faster. Here only the loading state subscribes, so a progress tick costs one small component
 * and nothing else.
 *
 * The values come from two places and mean one thing. The shell reports the steps it takes itself -
 * reading the pack, warming the first screen - and the game app reports the rest through
 * `GameAppHost.onBootProgress`; both go through {@link createGameBootReporter}, so the page's
 * performance timeline and this store can never disagree about what phase the boot is in.
 *
 * Comments in English per project convention.
 */
import { createGameBootReporter, type GameBootProgress } from "@/lib/ui-editor/runtime/app/bootTiming";

/**
 * The boot starts at "reading the game's own data", because it does: the pack read is under way
 * before anything can subscribe, and a first value of "nothing yet" would make every consumer
 * handle a state that lasts no time and means the same thing.
 */
let current: GameBootProgress = { phase: "bundle", at: 0 };

const listeners = new Set<() => void>();

export function publishRuntimeBootProgress(progress: GameBootProgress): void {
    // The boot ends once. A later report - a hot reload's story compile, a relaunch - must not put
    // a loading state back over a game the player is already looking at.
    if (current.phase === "firstFrame") {
        return;
    }
    current = progress;
    for (const listener of [...listeners]) {
        listener();
    }
}

export function getRuntimeBootProgress(): GameBootProgress {
    return current;
}

export function subscribeRuntimeBootProgress(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Test seam: puts the store back to the state a freshly loaded page is in. */
export function resetRuntimeBootProgress(): void {
    current = { phase: "bundle", at: 0 };
    listeners.clear();
}

/**
 * The shell's own phases: reading the pack, and warming the first screen's assets.
 *
 * Module-level and not a hook, because the steps it times run inside hooks that are called from
 * different components and it has to be the same reporter for all of them - a second one would open
 * a span the first cannot close. The phases the game app owns come through
 * `GameAppHost.onBootProgress` into {@link publishRuntimeBootProgress} instead, with a reporter of
 * their own; the two never share a span.
 */
export const runtimeShellBootReporter = createGameBootReporter(publishRuntimeBootProgress);
