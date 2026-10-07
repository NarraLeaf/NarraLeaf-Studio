/**
 * Replaying spoken lines - `Play Voice`, a backlog row's replay button - one take at a time.
 *
 * A replay is asked for while something is already speaking: the replay before it, a press on the
 * same row again, or the story's own line, whose take plays on under a backlog page opened over it.
 * Starting the new take beside any of them is two voices talking over each other, the layering
 * `voiceEndMode` already prevents between story lines. So a replay stops whatever voice is still
 * speaking first, and a press on the same row starts the line over. The other way round holds too:
 * the story's next voiced line stops a replay still speaking, as it stops the take before it.
 *
 * Kept apart from `GameApp` because the bookkeeping is the whole of the behaviour and none of it is
 * React: the component supplies "start this unit and hand me a token" and "stop the story's take".
 */
import type { LiveGame } from "narraleaf-react";

/** What this needs of a playing clip. Structurally the engine's sound token. */
export type VoiceReplayToken = {
    stop: () => unknown;
};

export type VoiceReplayer = {
    /**
     * Replay one line's take. Resolves true when it started; false when nothing could be played or a
     * later replay took over before this one's clip was ready.
     */
    play: (unitId: string) => Promise<boolean>;
    /** Stop the replay in progress, if there is one. */
    stop: () => void;
};

/** Stop a take, tolerating a backend that has already released it. */
function stopToken(token: VoiceReplayToken | null): void {
    if (!token) {
        return;
    }
    try {
        token.stop();
    } catch {
        // Already stopped, or torn down with its channel; either way it is not playing.
    }
}

export function createVoiceReplayer(deps: {
    /**
     * Start this unit's take and resolve its token, or null when there is nothing to play - no take
     * in the current dub language, or no running game.
     */
    start: (unitId: string) => Promise<VoiceReplayToken | null>;
    /** Stop the story's own take if it is still speaking. */
    stopStoryVoice?: () => void;
    /** Reports a failed start. */
    onError?: (error: unknown, unitId: string) => void;
}): VoiceReplayer {
    /**
     * The replay in progress. `token` is null while its clip is being fetched; `cancelled` is how a
     * stop that arrives inside that window is honoured once the token exists.
     */
    let current: { token: VoiceReplayToken | null; cancelled: boolean } | null = null;

    const stop = (): void => {
        if (!current) {
            return;
        }
        current.cancelled = true;
        stopToken(current.token);
        current = null;
    };

    return {
        stop,
        play: async unitId => {
            const id = unitId.trim();
            if (!id) {
                return false;
            }
            stop();
            const entry: { token: VoiceReplayToken | null; cancelled: boolean } = { token: null, cancelled: false };
            current = entry;
            try {
                deps.stopStoryVoice?.();
            } catch {
                // A story take that cannot be stopped is no reason not to replay the line asked for.
            }
            try {
                const token = await deps.start(id);
                if (!token) {
                    if (current === entry) {
                        current = null;
                    }
                    return false;
                }
                if (entry.cancelled) {
                    stopToken(token);
                    return false;
                }
                entry.token = token;
                return true;
            } catch (error) {
                if (current === entry) {
                    current = null;
                }
                deps.onError?.(error, id);
                return false;
            }
        },
    };
}

/**
 * Whether a line the story is about to speak has a take of its own: a voice unit id, or a clip
 * linked on the row itself.
 */
export function sentenceHasVoice(sentence: unknown): boolean {
    const config = (sentence as { config?: { voiceId?: unknown; voice?: unknown } } | null)?.config;
    return Boolean(config && (config.voiceId != null || config.voice != null));
}

/**
 * Stop the story's own take, when the newest voiced line's is still speaking.
 *
 * Only that one can be: every voice end mode but "none" stops a take when its line ends, and "none"
 * stops one when the next voiced line starts. Its `Sound` is the one the scene resolved for it -
 * `Scene.getVoice` keeps one per source - so asking the scene again hands back the instance the audio
 * manager is playing. A take linked on the row itself, with no unit id, is not reached.
 */
export function stopStoryVoiceTake(liveGame: LiveGame): void {
    const gameState = liveGame.getGameState();
    const scene = gameState?.getLastScene() as unknown as { getVoice?: (id: string) => unknown } | null | undefined;
    if (!gameState || typeof scene?.getVoice !== "function") {
        return;
    }
    const history = liveGame.getHistory() as unknown as ReadonlyArray<{ element?: { type?: unknown; voiceId?: unknown } }>;
    for (let index = history.length - 1; index >= 0; index--) {
        const element = history[index]?.element;
        if (element?.type !== "say" || element.voiceId == null) {
            continue;
        }
        const sound = scene.getVoice(String(element.voiceId)) as Parameters<typeof gameState.audioManager.stop>[0] | null;
        if (sound && gameState.audioManager.isPlaying(sound)) {
            void Promise.resolve(gameState.audioManager.stop(sound, 0)).catch(() => undefined);
        }
        return;
    }
}
