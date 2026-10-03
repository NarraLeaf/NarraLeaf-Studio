/**
 * When the surface stack may draw, and what a Start Game pressed before it is ready does.
 *
 * Both answers used to be one: the surfaces waited for the story environment, so by the time a
 * Start button existed the environment behind it did too. Dev Mode separates them - see
 * {@link GameAppHost.surfacesBeforeStoryBoot} - which makes the second question real.
 */

import type { DevModeStartStoryRequest } from "@shared/types/devMode";
import { needsRunningGame } from "./runtimeRefusals";

/**
 * Whether the page lane of the surface stack may draw.
 *
 * A host that draws ahead of the story boot still waits on a language restart: that one is putting
 * a playthrough back on screen, and drawing over it would show the player the wrong one.
 *
 * And on a story the host asked for in place (Dev Mode's row play control, pressed while the window
 * is open). That launch brings a new bundle, which puts the page stack back on the entry page, and
 * the window already has its boot behind it - so nothing else would stop the title screen from
 * painting, cold and with its buttons live, for as long as the story takes to compile and mount.
 * A window opened on a story never shows it; one asked for a story in place must not either.
 */
export function surfacesMayDraw(input: {
    /** The boot preload finished (or timed out, which counts). */
    storyBootFinished: boolean;
    /** The host does not want the surfaces held for the story environment. */
    hostDrawsBeforeStoryBoot: boolean;
    /** A language restart is putting a saved playthrough back. */
    localeResumePending: boolean;
    /** A story the host asked for in place has not reached its stage yet. */
    storyLaunchPending?: boolean;
}): boolean {
    return (input.storyBootFinished || input.hostDrawsBeforeStoryBoot)
        && !input.localeResumePending
        && !input.storyLaunchPending;
}

/**
 * Whether the layers may draw.
 *
 * Not held for the story boot the way the pages are. A layer open during a boot was opened by the
 * author's own graphs - `On Game Ready` above all: a splash, a notice, a first-run question - and
 * that graph is what the boot waits for, so holding its layer back until the boot was over meant the
 * layer opened, ran its course and closed again behind the loading screen. It only showed where a host
 * draws the pages early (Dev Mode opening on its interface), which made the same blueprint behave
 * differently in a story launch, in Preview and in the built game.
 *
 * A language restart still holds them, for the reason it holds the pages.
 */
export function layersMayDraw(input: {
    /** A language restart is putting a saved playthrough back. */
    localeResumePending: boolean;
}): boolean {
    return !input.localeResumePending;
}

/**
 * What the screen so far allows the boot to say: that the player is looking at the game, and that
 * `App Boot` may run.
 *
 * Two answers, because they stopped being one when a layer could be drawn during the boot. A
 * splash opened by `On Game Ready` is the first thing the player sees, so it ends the loading state
 * - but it is not the first screen `App Boot` is promised: that event runs once the game has
 * finished starting, with `On Game Ready` already over, on the page or stage the game opens on.
 *
 * `App Boot` also waits for the story boot itself. A host that draws its pages early (Dev Mode)
 * painted the entry page before `On Game Ready` had run, and the two events fired in the opposite
 * order to a built game's. And for a story asked for in place, it waits for that story's stage:
 * that is the screen such a launch opens on, as it is for a window opened on a story.
 */
export function resolveBootPaint(input: {
    /** The page the stack is settling on has had its first paint, or there is no page to wait for. */
    pagePainted: boolean;
    /** The story stage has been revealed. */
    stageVisible: boolean;
    /** A layer that is being drawn has had its first paint. */
    layerPainted: boolean;
    /** The boot preload finished (or timed out, which counts), so `On Game Ready` has run. */
    storyBootFinished: boolean;
    /** A story the host asked for in place has not reached its stage yet. */
    storyLaunchPending: boolean;
}): { firstFrame: boolean; appBoot: boolean } {
    const screenShowing = input.pagePainted || input.stageVisible;
    return {
        firstFrame: screenShowing || input.layerPainted,
        appBoot: screenShowing && input.storyBootFinished && !input.storyLaunchPending,
    };
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
/**
 * Mount the environment a menu stands on in the background, published where a boot is.
 *
 * A menu needs a game environment although nothing is being played on it: its buttons' sounds play
 * through it, a volume slider moves its mixer, and Load and Continue read a save into it. The boot
 * mounts one before the first page; a quit tears the run's one down and needs another under the
 * page it lands on. Published as `pendingBoot`, so a Start pressed meanwhile waits for it and then
 * enters the scene it warmed instead of mounting a second environment beside it.
 *
 * The published promise never rejects, which is the gate's contract for `pendingBoot`. A mount that
 * was superseded - by a hot reload, or by another quit - is not a failure: whatever superseded it
 * owns the environment now. Anything else is reported, and the gate is released either way.
 */
export function publishMenuEnvironmentMount(input: {
    mount: () => Promise<void>;
    pendingBoot: { current: Promise<void> | null };
    isSuperseded: (error: unknown) => boolean;
    onSuperseded: (error: unknown) => void;
    onFailure: (error: unknown) => void;
}): Promise<void> {
    const pending = (async () => {
        try {
            await input.mount();
        } catch (error) {
            if (input.isSuperseded(error)) {
                input.onSuperseded(error);
                return;
            }
            input.onFailure(error);
        }
    })();
    input.pendingBoot.current = pending;
    return pending;
}

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
                throw needsRunningGame("blueprint.node.startGame");
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
