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

export type StoryStartGate = (request: DevModeStartStoryRequest) => Promise<void>;

/**
 * The player entering a story, made to wait for a boot still in flight.
 *
 * Without the wait, a press that lands mid-boot reaches `startStoryInGame` with no live game and
 * takes its slow path: a second compile of the same story, racing the boot's own mount, with the
 * loser superseded. Waiting is both cheaper and what the press means - the player asked to play,
 * not to play twice.
 */
export function createStoryStartGate(input: {
    /** The boot in flight, or null when none is. Never rejects: the boot reports its own failures. */
    pendingBoot: { readonly current: Promise<void> | null };
    /** The runtime's own start, once it exists. */
    start: { readonly current: StoryStartGate | null };
}): StoryStartGate {
    return async request => {
        await input.pendingBoot.current;
        const start = input.start.current;
        if (!start) {
            throw new Error("Start Game: runtime is not ready");
        }
        await start(request);
    };
}
