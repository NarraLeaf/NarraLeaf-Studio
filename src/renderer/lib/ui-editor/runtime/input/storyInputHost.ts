/**
 * What a compiled story asks of the running game when a row addresses the player's hands.
 *
 * The compiler bakes calls to this into the statements it builds, the way it bakes `onEndingReached`:
 * shaking a pad, holding the story still and listening for an action are all acts only the running
 * game can perform, and a compiled story is cached and replayed across playthroughs, so the host is a
 * stable object that reads the live game when it is called rather than when the story was built.
 *
 * Absent for the compiles that are not playing a story - the build sweeps, the scene preview - whose
 * input rows compile to nothing.
 *
 * Comments in English per project convention.
 */

import type { StoryRumbleShape } from "@shared/types/story";
import type { UIInputActionDef } from "@shared/types/ui-editor/inputAction";
import { resolveSurfaceActionBindings } from "@shared/types/ui-editor/inputAction";
import { playGamepadRumble, stopGamepadRumble } from "./gamepadHaptics";
import { getSharedInputHoldTracker, isInputBindingHeld } from "./inputHoldState";
import { waitForStoryInput, type StoryInputWaitRequest } from "./storyInputWait";

export type StoryInputHost = {
    /** Shake the pad. Resolves at once, or - with `wait` - once the rumble has run. */
    rumble: (shape: StoryRumbleShape, options: { wait: boolean; signal?: AbortSignal }) => Promise<void>;
    stopRumble: () => void;
    /** Take the story out of the player's hands, or give it back. Not a count: two locks need one unlock. */
    setAdvanceLocked: (locked: boolean) => void;
    /** Whether a story row has the player locked out right now. */
    isAdvanceLocked: () => boolean;
    /** Wait for a gesture; see `storyInputWait`. */
    waitForInput: (request: StoryInputWaitRequest, signal: AbortSignal) => Promise<boolean>;
};

/** A host the game owns: the interface plus what the game does to it between playthroughs. */
export type GameStoryInputHost = StoryInputHost & {
    /** Let go of everything a story row took: the lock, any rumble still running, and every wait. */
    reset: () => void;
};

export type GameStoryInputHostDeps = {
    /**
     * Whether the player is skipping. A rumble asked for while the story is being skipped through is
     * one the player did not see the reason for, so it is not played - and a dozen skipped rows would
     * otherwise land on the hands at once.
     */
    isSkipping: () => boolean;
    /** The project's action vocabulary, read when a row asks. */
    readActions: () => Readonly<Record<string, UIInputActionDef>> | undefined;
    /**
     * Take a suspension of the engine's advance on the live game (a stage click, the advance key and
     * auto-forward all do nothing while one is out), returning its release - or null when there is no
     * game to hold. `stageAdvanceHold`'s `holdStageAdvance` is the expected shape, release included,
     * because releasing has to wake auto-forward as well.
     */
    holdAdvance: () => { release: () => void } | null;
    /**
     * Whether a page or a modal layer is drawn over the stage at this instant. A waiting row neither
     * hears presses nor spends its time while one is (see `storyInputWait`).
     */
    isStageCovered: () => boolean;
};

/** Whether one action's bindings are down, read the way `Is Action Held` reads them minus the surface. */
function isActionHeld(def: UIInputActionDef | undefined): boolean {
    if (!def) {
        return false;
    }
    const held = getSharedInputHoldTracker().read();
    return resolveSurfaceActionBindings(def).some(binding => isInputBindingHeld(binding, held));
}

export function createGameStoryInputHost(deps: GameStoryInputHostDeps): GameStoryInputHost {
    let lock: { release: () => void } | null = null;
    let locked = false;
    /** How to drop each wait still in flight - see `reset`. */
    const pendingWaits = new Set<() => void>();

    const setAdvanceLocked = (next: boolean): void => {
        if (next === locked) {
            return;
        }
        locked = next;
        if (next) {
            lock = deps.holdAdvance();
            return;
        }
        const current = lock;
        lock = null;
        current?.release();
    };

    return {
        rumble: async (shape, options) => {
            if (deps.isSkipping()) {
                return;
            }
            await playGamepadRumble(shape, { wait: options.wait, signal: options.signal });
        },
        stopRumble: () => stopGamepadRumble(),
        setAdvanceLocked,
        isAdvanceLocked: () => locked,
        waitForInput: (request, signal) => new Promise<boolean>(resolve => {
            // The wait's own controller, aborted by the row's signal or by `reset`: either way
            // `waitForStoryInput` takes its timers and its listener down.
            const controller = new AbortController();
            let dropped = false;
            const forward = (): void => controller.abort();
            const drop = (): void => {
                dropped = true;
                controller.abort();
            };
            pendingWaits.add(drop);
            if (signal.aborted) {
                controller.abort();
            } else {
                signal.addEventListener("abort", forward, { once: true });
            }
            void waitForStoryInput(request, {
                isActionHeld: actionId => {
                    const actions = deps.readActions() ?? {};
                    return actionId
                        ? isActionHeld(actions[actionId])
                        : Object.values(actions).some(def => isActionHeld(def));
                },
                isStageCovered: deps.isStageCovered,
            }, controller.signal).then(passed => {
                pendingWaits.delete(drop);
                signal.removeEventListener("abort", forward);
                // A wait `reset` dropped never settles. Its run is being replaced - a new game, a
                // load, the session going away - so there is no row to move past and no answer to
                // write, and settling `false` would write one into the run that replaces it before
                // the engine got round to abandoning the row. The engine abandons it on its own when
                // it resets the stack (see `storyAwaitedAction`).
                if (!dropped) {
                    resolve(passed);
                }
            });
        }),
        reset: () => {
            // A `/hold` polls the pad and the keys until it settles, and every wait listens for
            // actions: one left running past the run it belonged to keeps doing both for nobody.
            for (const drop of [...pendingWaits]) {
                drop();
            }
            setAdvanceLocked(false);
            stopGamepadRumble();
        },
    };
}
