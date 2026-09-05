/**
 * When the surface stack may draw, and what a Start Game pressed before it is ready does.
 *
 * Both answers used to be one: the surfaces waited for the story environment, so by the time a
 * Start button existed the environment behind it did too. Dev Mode separates them - see
 * {@link GameAppHost.surfacesBeforeStoryBoot} - which makes the second question real.
 */

import type { DevModeStartStoryRequest } from "@shared/types/devMode";

/**
 * Whether the surface stack may draw.
 *
 * A host that draws ahead of the story boot still waits on a language restart: that one is putting
 * a playthrough back on screen, and drawing over it would show the player the wrong one.
 */
export function surfacesMayDraw(input: {
    /** The boot preload finished (or timed out, which counts). */
    storyBootFinished: boolean;
    /** The host does not want the surfaces held for the story environment. */
    hostDrawsBeforeStoryBoot: boolean;
    /** A language restart is putting a saved playthrough back. */
    localeResumePending: boolean;
}): boolean {
    return (input.storyBootFinished || input.hostDrawsBeforeStoryBoot) && !input.localeResumePending;
}

export type StoryStartGate = (
    request: DevModeStartStoryRequest,
    /** What a Load Save carries into the run it starts; forwarded, never the gate's to read. */
    options?: { inheritSavedGame?: unknown },
) => Promise<void>;

/**
 * The player entering a story, made to wait for a boot still in flight.
 *
 * Without the wait, a press that lands mid-boot reaches `startStoryInGame` with no live game and
 * takes its slow path: a second compile of the same story, racing the boot's own mount, with the
 * loser superseded. Waiting is both cheaper and what the press means - the player asked to play,
 * not to play twice.
 *
 * Every surface a game draws reaches `startStory` through this - the page, a frame inside it and a
 * Game UI slot alike. They used to differ: only the slot waited, because only the slot had a reason
 * of its own to go through a ref. The window they disagreed about is exactly the one Dev Mode makes
 * wide, since the title screen is up seconds before the story behind it is warm, and Start Game is
 * on the title screen.
 */
export function createStoryStartGate(input: {
    /** The boot in flight, or null when none is. Never rejects: the boot reports its own failures. */
    pendingBoot: { readonly current: Promise<void> | null };
    /** The runtime's own start, once it exists. */
    start: { readonly current: StoryStartGate | null };
}): StoryStartGate {
    /**
     * The start already running and what it was for, so a second press of the same button joins it.
     *
     * The wait above is what makes this necessary. A press that has to wait looks to the player
     * exactly like a press that did nothing, so they press again - and every press used to be
     * another run of `startStoryInGame`, all of them released at once when the boot settled, each
     * superseding the last. What the player saw for that was the title screen, unchanged.
     *
     * Only an identical request folds in. A different story, or one carrying a saved game, is a
     * different thing to have asked for and still runs on its own.
     */
    let inFlight: { key: string; done: Promise<void> } | null = null;

    return async (request, options) => {
        const key = options?.inheritSavedGame === undefined
            ? JSON.stringify([request.storyId, request.sceneId, request.startBlockId ?? "", request.snapshotId ?? ""])
            : null;
        if (key !== null && inFlight?.key === key) {
            await inFlight.done;
            return;
        }
        const done = (async () => {
            await input.pendingBoot.current;
            const start = input.start.current;
            if (!start) {
                throw new Error("Start Game: runtime is not ready");
            }
            await start(request, options);
        })();
        if (key !== null) {
            const entry = { key, done };
            inFlight = entry;
            void done.catch(() => undefined).then(() => {
                if (inFlight === entry) {
                    inFlight = null;
                }
            });
        }
        await done;
    };
}
