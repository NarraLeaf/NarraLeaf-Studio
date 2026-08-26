/**
 * The line the player is on, held for as long as something is drawn over the stage.
 *
 * ## Why this is not the skip loop's answer
 *
 * Skipping runs in Studio, so a predicate was enough to stop it: `skipRunController` asks whether
 * the story is on screen before every step (see `stageOcclusion`). Auto-forward is not reachable
 * that way. Its timer lives in the engine's `DialogState`, and when it comes due the engine emits
 * `simulateClick`, which the dialog answers by clicking its own DOM node - a path with no host
 * predicate anywhere along it. MEASURED: auto-forward turned on and then a settings screen opened
 * ran five actions in sixteen seconds behind it.
 *
 * What the engine offers instead is `gameState.suspendAdvance()`: while at least one suspension is
 * out, a stage click, the advance key and the auto-forward click all do nothing, and suspensions
 * nest. That is what this holds - one suspension for as long as the stage is covered.
 *
 * ## Why releasing has a second half
 *
 * The auto-forward timer is armed once per line, when the line finishes displaying, and it is a
 * one-shot: the click it fires while a suspension is out is swallowed and never comes again. So a
 * release on its own would hand the player a story that is no longer suspended and no longer moving
 * - the settings screen closes and the line just sits there until the player clicks it.
 *
 * The engine re-arms the line on screen whenever the `autoForward` preference is written, so a
 * write of the value it already holds is what wakes it, and the line then gets a full pause before
 * it moves - which is the pause a player who has just closed a settings screen should get.
 * {@link StageAdvanceHoldHooks.rearmAutoForward} is that write; the host is responsible for keeping
 * it off the authored `On Preference Changed` stream, since nothing about the player's settings
 * changed.
 *
 * Comments in English per project convention.
 */

export type StageAdvanceHoldHooks = {
    /**
     * Take a suspension on the running game, or null when there is no game state to hold - a
     * session that is still mounting, or one that has already gone.
     */
    suspendAdvance: () => (() => void) | null;
    /**
     * Whether the game this hold was taken on is still the one on screen.
     *
     * A hold released because the playthrough ended has nothing to wake: the line it was holding
     * belongs to a session that no longer exists, and the next one starts its own.
     */
    isSessionCurrent: () => boolean;
    /** Whether the player has auto-forward on. */
    isAutoForwardOn: () => boolean;
    /** Write the `autoForward` preference its current value back, re-arming the line on screen. */
    rearmAutoForward: () => void;
};

/** A hold on the story, and the one call that ends it. */
export type StageAdvanceHold = {
    /** Whether a suspension is actually out; false when there was no game to hold. */
    held: boolean;
    /** Hand the line back, and wake auto-forward if it is the player's. Safe to call twice. */
    release: () => void;
};

/**
 * Hold the story where it is until the returned release is called.
 *
 * Shaped for an effect: taking the hold is the mount and releasing it is the cleanup, so the
 * suspension cannot outlive the render that decided the stage was covered.
 */
export function holdStageAdvance(hooks: StageAdvanceHoldHooks): StageAdvanceHold {
    const release = hooks.suspendAdvance();
    let released = false;
    return {
        held: release !== null,
        release: () => {
            if (released) {
                return;
            }
            released = true;
            release?.();
            // Nothing to wake when there was nothing to hold, when the session went away under the
            // hold, or when the player never asked the story to move on its own.
            if (release === null || !hooks.isSessionCurrent() || !hooks.isAutoForwardOn()) {
                return;
            }
            hooks.rearmAutoForward();
        },
    };
}

/** One hold at a time, kept in step with the answer rather than with the edges of it. */
export type StageAdvanceHolder = {
    /**
     * Bring the hold in line with whether the stage is covered right now.
     *
     * Idempotent in both directions: called with `true` while it is already holding it does
     * nothing, and called with `false` while it holds nothing does nothing.
     */
    sync: (stageCovered: boolean) => void;
    /** Hand the line back whatever the last answer was. Safe to call twice. */
    dispose: () => void;
};

/**
 * Keep at most one hold, and keep it only while the stage is covered.
 *
 * {@link holdStageAdvance} is an edge - taken on the way in, handed back on the way out - and in
 * `GameApp` both edges are one React effect firing. That makes every half of the answer a single
 * event, and a single event that does not arrive is permanent: the suspension is on a `Set` inside
 * the engine's `GameState`, nothing else ever looks at it, and while it is out the stage click, the
 * advance key and auto-forward all do nothing. MEASURED: opening the in-game Save panel and closing
 * it again left exactly one suspension out for the rest of the playthrough, with nothing at all
 * drawn over the stage.
 *
 * The holder asks the question again on every commit instead of only when the answer changes, which
 * fixes both halves of that: a cover that is up while there is no game state yet is held as soon as
 * there is one, and a stage that is not covered hands the line back on any commit rather than on one
 * particular edge.
 *
 * It cannot let go early. `sync(true)` never releases - the only release is `sync(false)`, which is
 * the same condition the effect's cleanup ran on - so a page or modal layer that is genuinely over
 * the stage keeps its suspension for every commit it is up for.
 *
 * `takeHold` is a factory rather than the hooks themselves so the caller can bind each hold to the
 * live game it finds at that moment: a hold retried after a session arrived belongs to that session,
 * not to the one that was there when the cover went up.
 */
export function createStageAdvanceHolder(takeHold: () => StageAdvanceHold): StageAdvanceHolder {
    let hold: StageAdvanceHold | null = null;
    const letGo = (): void => {
        const current = hold;
        hold = null;
        current?.release();
    };
    return {
        sync: (stageCovered: boolean): void => {
            if (!stageCovered) {
                letGo();
                return;
            }
            if (hold?.held) {
                return;
            }
            // Either nothing has been taken yet, or the last attempt found no game state to hold -
            // which holds nothing at all and has nothing to wake, so dropping it costs nothing.
            letGo();
            hold = takeHold();
        },
        dispose: letGo,
    };
}
