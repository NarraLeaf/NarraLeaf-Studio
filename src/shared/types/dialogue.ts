/**
 * The author's dialogue settings: values the game is written around, not values the player picks.
 *
 * ## Why this is not a preference
 *
 * Everything the engine reads about pacing has, until now, been the player's: text speed, the
 * auto-forward wait, game speed. They live in `app.preferences` and a settings screen may move any
 * of them (see `@shared/types/preference`). A pause written into a line is not that kind of value.
 * The author put it there for the same reason they put a comma there, and how long it lasts belongs
 * with the writing.
 *
 * So this is the first of a second kind: project configuration the engine reads as *config*, sitting
 * beside the other `app.*` sections rather than in the preference table. Adding it as a fifteenth
 * preference would have put a typographic decision on the player's settings screen and written it
 * into every player's saved preferences - and `preference.test.ts` guards the shape of that table
 * precisely so a value that is not the player's cannot drift into it.
 *
 * ## What the engine does with it
 *
 * A pause with no duration on it waits for a click. With auto-forward on there is nobody clicking,
 * so the engine waits `autoForwardDefaultPause` instead (scaled by game speed, like the rest of the
 * pacing) and carries on. Studio never passed it, so every project shipped with the engine's own
 * 1000ms however the writing was paced.
 *
 * Comments in English per project convention.
 */

export type DialogueConfiguration = {
    /**
     * Milliseconds a pause with no duration holds a line while the player has auto-forward on.
     *
     * `Game.DefaultConfig.autoForwardDefaultPause` in the engine.
     */
    autoForwardDefaultPause: number;
};

/** The engine's own value, so a project that has never opened the page ships what it always did. */
export const DEFAULT_DIALOGUE_CONFIGURATION: DialogueConfiguration = {
    autoForwardDefaultPause: 1000,
};

/** Zero is a real answer: it makes a pause pass straight through while auto-forward is on. */
export const AUTO_FORWARD_DEFAULT_PAUSE_MIN = 0;
/** The ceiling `autoForwardDelay` uses, so the two pacing fields refuse the same values. */
export const AUTO_FORWARD_DEFAULT_PAUSE_MAX = 30000;

/**
 * Coerce a persisted value into a complete dialogue configuration.
 *
 * Dense like the autosave and save-compatibility policies next door: a project written before this
 * existed carries nothing, and every reader is entitled to a number without repeating the fallback.
 */
export function normalizeDialogueConfiguration(value: unknown): DialogueConfiguration {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_DIALOGUE_CONFIGURATION };
    }
    const record = value as Record<string, unknown>;
    const pause = record.autoForwardDefaultPause;
    if (typeof pause !== "number" || !Number.isFinite(pause)) {
        return { ...DEFAULT_DIALOGUE_CONFIGURATION };
    }
    return {
        autoForwardDefaultPause: Math.min(
            AUTO_FORWARD_DEFAULT_PAUSE_MAX,
            Math.max(AUTO_FORWARD_DEFAULT_PAUSE_MIN, Math.round(pause)),
        ),
    };
}
