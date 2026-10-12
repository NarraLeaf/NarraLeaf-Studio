/**
 * A story row waiting for the player's hands: one press, a press held down, or a run of presses.
 *
 * # What the row listens to
 *
 * The project's input actions, not raw keys. An action is the thing the author has already named -
 * "Advance", "Confirm", "Dodge" - and its bindings are where the keyboard, the mouse, a touch and a
 * pad meet, so a row that waits for an action is answered by whatever the player is holding. A row
 * that named a key would be a QTE a pad player cannot pass.
 *
 * Every action the game performs is announced here by {@link announceStoryInputActions}, which the
 * one funnel all three routes share calls (`answerGlobalInputActions`: keys, pads, and pointer input
 * whichever lane it landed on). So the row hears what the global blueprint's `On Action` hears, under
 * the same rules - not while a text field has focus, not a gesture a control under the pointer has
 * spoken for - less what is made while the stage is covered (below), which the global hears and the
 * story does not.
 *
 * # Holding
 *
 * A hold is read off the hold tracker on a short timer - the same "is it down right now" question
 * `Is Action Held` asks - rather than started by the action firing. An action bound to a click fires
 * on the click, which is the button coming back UP: a hold that waited for the action to fire before
 * it started counting could never be passed with a mouse.
 *
 * Two rules keep the reading honest. The action has to be seen released once after the row starts, so
 * a key still down from the line before - the Space that advanced to this row - does not count towards
 * a hold nobody has started. And letting go before the time is up does not fail the row; the count
 * starts over on the next press, because a player who slipped has not refused.
 *
 * The timer is a `setTimeout` rather than an animation frame: a window the OS has occluded stops
 * painting, and a hold that only advanced on frames would never complete behind it.
 *
 * # While something covers the stage
 *
 * A page or a modal layer drawn over the stage - the settings screen, a confirm dialog - has the
 * player's hands, and the story behind it is paused: the engine takes no advance while one is up.
 * A waiting row pauses with it. A press made there is an answer to the page, not to the story, so it
 * does not count; and the time spent there is not time the player had, so neither the deadline nor a
 * hold moves until the stage is uncovered again. The cover is read when it matters (a press, a timer
 * tick) through {@link StoryInputWaitDeps.isStageCovered}, the same reading the global blueprint's
 * `Is Game Overlay` gives, rather than pushed here: a row is short-lived, and reading the one answer
 * keeps the game from having to track who is waiting.
 *
 * Comments in English per project convention.
 */

export type StoryInputWaitRequest = {
    operation: "wait" | "hold" | "mash";
    /** The action to wait for. Absent: any action. */
    actionId?: string;
    /** `hold` - how long the action has to stay down. */
    holdMs?: number;
    /** `mash` - how many presses. */
    count?: number;
    /** Give up after this long; absent waits forever. */
    timeoutMs?: number;
};

type ActionListener = (actionIds: readonly string[]) => void;

const listeners = new Set<ActionListener>();

/**
 * The game performed these actions. Called once per input, with every action the input matched.
 *
 * Listeners are snapshotted first, so a row that finishes on this input and a row that starts because
 * of it cannot both hear it: the starting row subscribes after the snapshot was taken.
 */
export function announceStoryInputActions(actions: readonly { actionId: string }[]): void {
    if (actions.length === 0 || listeners.size === 0) {
        return;
    }
    const ids = actions.map(action => action.actionId);
    for (const listener of [...listeners]) {
        try {
            listener(ids);
        } catch {
            // One listener failing must not cost the next its input.
        }
    }
}

/** Hear every announced input until the returned function is called. */
export function onStoryInputActions(listener: ActionListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** How often a hold re-reads the tracker. Fine enough that a one-second hold lands within a frame or two. */
const HOLD_POLL_MS = 16;

/**
 * How often a deadline looks at whether the stage is covered. A cover that comes or goes between two
 * looks is counted from the next one, so this is the most a deadline can be off by per cover.
 */
const DEADLINE_POLL_MS = 50;

export type StoryInputWaitDeps = {
    /** Whether this action's bindings are down right now; with no action, whether any action's are. */
    isActionHeld: (actionId: string | undefined) => boolean;
    /**
     * Whether a page or a modal layer is drawn over the stage right now. While it is, presses do not
     * count and the row's time stands still (see the module comment). Absent: never covered.
     */
    isStageCovered?: () => boolean;
    now?: () => number;
};

/**
 * Wait for the gesture. Resolves `true` when the player made it and `false` when the deadline passed
 * first - or when `signal` aborted, which the caller tells apart by reading the signal.
 */
export function waitForStoryInput(
    request: StoryInputWaitRequest,
    deps: StoryInputWaitDeps,
    signal?: AbortSignal,
): Promise<boolean> {
    const now = deps.now ?? (() => Date.now());
    const covered = deps.isStageCovered ?? (() => false);
    return new Promise<boolean>(resolve => {
        if (signal?.aborted) {
            resolve(false);
            return;
        }
        let settled = false;
        let deadline: ReturnType<typeof setTimeout> | null = null;
        let holdTimer: ReturnType<typeof setTimeout> | null = null;
        let presses = 0;
        // Deaf until the task this row started in has finished. A row can start in the middle of an
        // input's dispatch - the engine's own dialogue box advances on its click listener, the story
        // runs on to this row, and the same click then bubbles up to the game root and is announced.
        // Counting it would pass a wait the instant it began, with the press that led into it. No
        // player can press anything within one task, so nothing real is lost.
        let listening = false;
        const listenTimer = setTimeout(() => {
            listening = true;
        }, 0);

        const finish = (result: boolean): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(listenTimer);
            unsubscribe();
            if (deadline !== null) {
                clearTimeout(deadline);
            }
            if (holdTimer !== null) {
                clearTimeout(holdTimer);
            }
            signal?.removeEventListener("abort", onAbort);
            resolve(result);
        };
        const onAbort = (): void => finish(false);
        // The press that completes a wait or a mash is still on its way through the game when this
        // listener hears it: the global blueprint has it, the page under the pointer and the dialogue
        // box have not. Settling at once would let the story move to the next line in the middle of
        // that, and the same press would then advance the line it just revealed. So the row stops
        // listening now and lets go after the input has finished - one task later, past every
        // promise the dispatch chains.
        const succeedAfterInput = (): void => {
            unsubscribe();
            clearDeadline();
            setTimeout(() => finish(true), 0);
        };
        // The gesture is complete; whatever comes now is not a reason to fail it.
        const clearDeadline = (): void => {
            if (deadline !== null) {
                clearTimeout(deadline);
                deadline = null;
            }
        };

        const matching = (ids: readonly string[]): string | null => {
            if (!request.actionId) {
                return ids[0] ?? null;
            }
            return ids.includes(request.actionId) ? request.actionId : null;
        };

        // `hold` - see the module comment. `armed` once the action has been seen up since the row
        // started; `heldFor` how long it has been down without a break, counted between two readings
        // that both saw it down (`holding`); `reached` once it has been down long enough.
        //
        // A reached hold settles when the player lets go, not the moment the time is up. A mouse
        // button coming up is a click, and a click is an advance: settling first would put the next
        // line on screen just in time for the release to click straight past it. Waiting for the
        // release lets that click land while the row is still waiting, where it does nothing.
        //
        // While the stage is covered the action is not read at all: what the player does on a menu is
        // not a hold of this row, so the count neither grows nor breaks, and it carries on from where
        // it was if the action is still down once the stage is back.
        let armed = false;
        let holding = false;
        let heldFor = 0;
        let reached = false;
        let lastPoll = now();
        const pollHold = (): void => {
            holdTimer = null;
            if (settled) {
                return;
            }
            const at = now();
            const elapsed = at - lastPoll;
            lastPoll = at;
            if (covered()) {
                holding = false;
            } else {
                const held = deps.isActionHeld(request.actionId);
                if (reached) {
                    if (!held) {
                        finish(true);
                        return;
                    }
                } else if (!held) {
                    armed = true;
                    holding = false;
                    heldFor = 0;
                } else if (armed) {
                    if (holding) {
                        heldFor += elapsed;
                    }
                    holding = true;
                    if (heldFor >= Math.max(0, request.holdMs ?? 0)) {
                        reached = true;
                        clearDeadline();
                    }
                }
            }
            holdTimer = setTimeout(pollHold, HOLD_POLL_MS);
        };

        // The deadline counts only time the stage was uncovered (see the module comment), so it is a
        // stopwatch read on a short timer rather than one timer for the whole length.
        let timeLeft = typeof request.timeoutMs === "number" && Number.isFinite(request.timeoutMs) && request.timeoutMs >= 0
            ? request.timeoutMs
            : null;
        let lastTick = now();
        const tickDeadline = (): void => {
            deadline = null;
            if (settled || timeLeft === null) {
                return;
            }
            const at = now();
            if (!covered()) {
                timeLeft -= at - lastTick;
            }
            lastTick = at;
            if (timeLeft <= 0) {
                finish(false);
                return;
            }
            deadline = setTimeout(tickDeadline, Math.min(timeLeft, DEADLINE_POLL_MS));
        };

        const unsubscribe = onStoryInputActions(ids => {
            const actionId = matching(ids);
            // A press made while something covers the stage was made on that, not on the story.
            if (actionId === null || settled || !listening || covered()) {
                return;
            }
            if (request.operation === "wait") {
                succeedAfterInput();
                return;
            }
            if (request.operation === "mash") {
                presses += 1;
                if (presses >= Math.max(1, Math.round(request.count ?? 1))) {
                    succeedAfterInput();
                }
            }
            // A hold does not listen: it reads the tracker (see `pollHold`).
        });

        signal?.addEventListener("abort", onAbort, { once: true });
        if (request.operation === "hold") {
            pollHold();
        }
        if (timeLeft !== null) {
            tickDeadline();
        }
    });
}
