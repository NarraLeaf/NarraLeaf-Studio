/**
 * The display, held awake for as long as the story is moving without the player.
 *
 * Auto mode is the case: it plays for an hour with no input at all, and the system reads that as an
 * idle machine and blanks the screen mid-scene. Nothing a game draws says otherwise - animation and
 * audio reset no idle timer, unlike a playing `<video>` - so the shell has to be told, which is
 * what `GameAppHost.setDisplayAwake` is for.
 *
 * Deliberately narrower than "a game is running". Auto-forward is a stored player preference, so a
 * player who quits with it on comes back to a title screen with it still on, and a hold taken on
 * the preference alone would keep that title screen lit for as long as it is left there. The second
 * question - is the story on screen - is the same one the skip loop asks before every step, and it
 * covers a settings screen drawn over the stage as well: while the stage is covered the engine's
 * advance is suspended (see `stageAdvanceHold`), so nothing is moving to keep the display for.
 *
 * Comments in English per project convention.
 */

/**
 * How often the two answers are re-read on their own.
 *
 * Auto-forward turning on or off arrives on the preference stream and needs no polling. The story
 * arriving on screen does not: entering a playthrough writes refs the session gate reads rather
 * than state React re-renders on, so nothing announces it. This is the slow half of the answer, and
 * it can afford to be slow - what it decides is a display timeout measured in minutes.
 */
export const DISPLAY_AWAKE_RECHECK_MS = 4000;

export type DisplayAwakeHooks = {
    /** Whether the player has auto-forward on. */
    isAutoForwardOn: () => boolean;
    /** Whether the story is the thing on screen, rather than the thing behind what is on screen. */
    isStoryOnScreen: () => boolean;
    /** Tell the shell. Called only when the answer changes, never to repeat it. */
    setAwake: (awake: boolean) => void;
};

export type DisplayAwakeController = {
    /** Re-read both answers, and tell the shell if the outcome changed. */
    sync: () => void;
    /** Let the display sleep again. Safe to call twice. */
    stop: () => void;
};

export function createDisplayAwakeController(hooks: DisplayAwakeHooks): DisplayAwakeController {
    let awake = false;
    const set = (next: boolean): void => {
        if (next === awake) {
            return;
        }
        awake = next;
        hooks.setAwake(next);
    };
    return {
        sync: () => {
            set(hooks.isAutoForwardOn() && hooks.isStoryOnScreen());
        },
        stop: () => {
            set(false);
        },
    };
}
