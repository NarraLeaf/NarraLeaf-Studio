/**
 * Speaking choice options: at most one instance of each option at a time.
 *
 * A choice row's trigger is usually a hover, which fires every time the pointer crosses the row. So
 * the take of a line already speaking is left running rather than restarted from the top - and that
 * is per line: two options never block each other, because they are two different lines and a menu
 * that reads them over each other is a legitimate design. Whether a *different* option cuts this one
 * is therefore the author's call, carried on `Play Choice Voice`'s `Interrupt Others` pin.
 *
 * Kept apart from `GameApp` because the bookkeeping is the whole of the behaviour and none of it is
 * React: the component supplies "start this unit and hand me a token", nothing more.
 * Comments in English per project convention.
 */

/** What this needs of a playing clip. Structurally the engine's sound token. */
export type ChoiceVoiceToken = {
    isPlaying: () => boolean;
    stop: () => unknown;
    once: (event: string, callback: () => void) => unknown;
};

export type ChoiceVoicePlayer = {
    /**
     * Speak one option. Resolves true when this call is what started it; false when the line was
     * already speaking, has no take, or could not be played.
     */
    play: (unitId: string, options?: { interruptOthers?: boolean }) => Promise<boolean>;
};

/**
 * One option's take while it is speaking. `token` is null between the play being asked for and the
 * clip being ready; `cancelled` is how a stop that arrives inside that window is honoured once the
 * token exists.
 */
type ChoiceVoicePlayback = { token: ChoiceVoiceToken | null; cancelled: boolean };

/** The events a token reports when it stops of its own accord or is stopped. */
const TOKEN_END_EVENTS = ["ended", "stop"] as const;

/** Stop a take, tolerating a backend that has already released it. */
function stopToken(token: ChoiceVoiceToken | null): void {
    if (!token) {
        return;
    }
    try {
        token.stop();
    } catch {
        // Already stopped, or torn down with its channel; either way it is not playing.
    }
}

export function createChoiceVoicePlayer(deps: {
    /**
     * Start this unit's take and resolve its token, or null when there is nothing to play - no take
     * in the current dub language, or no running game.
     */
    start: (unitId: string) => Promise<ChoiceVoiceToken | null>;
    /** Reports a failed start. A choice that will not speak must not take the menu down with it. */
    onError?: (error: unknown) => void;
}): ChoiceVoicePlayer {
    const playbacks = new Map<string, ChoiceVoicePlayback>();

    const forget = (unitId: string, entry: ChoiceVoicePlayback): void => {
        if (playbacks.get(unitId) === entry) {
            playbacks.delete(unitId);
        }
    };

    return {
        play: async (unitId, options) => {
            const id = unitId.trim();
            if (!id) {
                return false;
            }
            const current = playbacks.get(id);
            // A null token means the clip is still being fetched, which counts as speaking: two
            // hovers inside that window would otherwise both start the same line, and that window is
            // precisely where a hover-driven trigger lands.
            if (current && (!current.token || current.token.isPlaying())) {
                return false;
            }
            playbacks.delete(id);
            if (options?.interruptOthers) {
                for (const [otherId, other] of [...playbacks]) {
                    playbacks.delete(otherId);
                    other.cancelled = true;
                    stopToken(other.token);
                }
            }
            const entry: ChoiceVoicePlayback = { token: null, cancelled: false };
            playbacks.set(id, entry);
            try {
                const token = await deps.start(id);
                if (!token) {
                    forget(id, entry);
                    return false;
                }
                // Cut while the clip was still loading: stop it as soon as it exists rather than
                // leave it playing behind the option that replaced it.
                if (entry.cancelled) {
                    stopToken(token);
                    return false;
                }
                entry.token = token;
                for (const event of TOKEN_END_EVENTS) {
                    token.once(event, () => forget(id, entry));
                }
                return true;
            } catch (error) {
                forget(id, entry);
                deps.onError?.(error);
                return false;
            }
        },
    };
}
