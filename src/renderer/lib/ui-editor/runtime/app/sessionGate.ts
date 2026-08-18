/**
 * "Is a game running, and may I have it?" — answered at call time, never at build time.
 *
 * Every Game UI slot surface (dialogue box, notifications, choice list, NVL, on-stage) is built once,
 * inside `mountNlrSession`, and handed to the engine as part of the game config; nothing rebuilds it
 * when `GameApp` re-renders. A gate that closed over React state would therefore keep answering with
 * whatever was true *before* the session it serves existed — which is "no game", for that game's
 * whole life. That is how the skeleton's quick menu came to have a dead Auto and a dead Skip: both
 * nodes ask the host for the live game, every such call from a slot surface threw
 * "game runtime is not available", and `Is In Game` always said no — while the very same nodes
 * worked from a page surface, whose host API is rebuilt on every render.
 *
 * So the gate reads refs, and only refs. Callers keep the two React states (the stage still has to
 * re-render when they change) and write them through mirrors; see `GameApp`.
 *
 * Comments in English per project convention.
 */

/** A `useRef`-shaped holder. Declared structurally so a test needs no React. */
type Ref<T> = { readonly current: T };

export type SessionGateRefs<TLiveGame> = {
    /** The mounted session, or null between sessions. */
    sessionId: Ref<string | null>;
    /**
     * The session the live game below belongs to. A mismatch means what is in `liveGame` outlived
     * the session that created it — a relaunch in flight — and must not be handed out.
     */
    liveGameSessionId: Ref<string | null>;
    liveGame: Ref<TLiveGame | null>;
    /** Whether the stage is on screen: the difference between "mounted" and "being played". */
    stageVisible: Ref<boolean>;
    /** Whether a game was entered on this session: the difference between "on screen" and "played". */
    gameEntered: Ref<boolean>;
};

export type SessionGate<TLiveGame> = {
    /**
     * The mounted session's live game, or a throw naming the operation that wanted it. The message
     * is what an author sees in the Dev Mode issues panel, so it leads with their node's name.
     */
    requireLiveGame: (operation: string) => TLiveGame;
    /** Whether a session is mounted and its stage is on screen. */
    isInGame: () => boolean;
    /**
     * Whether the mounted session has a live game to act on at all - mounted or not entered, on
     * screen or behind a menu. What a caller asks when it is waiting for an environment to come up
     * rather than asking whether one is being played.
     */
    hasLiveGame: () => boolean;
    /**
     * Whether a playthrough is running and could be serialized right now.
     *
     * Narrower than {@link isInGame}, and asked by everything that acts on the run rather than
     * draws it: the autosave scheduler, the playtime clock, and the language change that has to
     * decide whether switching costs a restart. It lives here rather than beside them so it is
     * built from refs by construction - the same reason the rest of this file exists.
     */
    isPlaythroughRunning: () => boolean;
};

export function createSessionGate<TLiveGame>(refs: SessionGateRefs<TLiveGame>): SessionGate<TLiveGame> {
    return {
        requireLiveGame: (operation: string): TLiveGame => {
            const sessionId = refs.sessionId.current;
            const liveGame = refs.liveGame.current;
            if (!sessionId || refs.liveGameSessionId.current !== sessionId || !liveGame) {
                throw new Error(`${operation}: game runtime is not available`);
            }
            return liveGame;
        },
        isInGame: (): boolean => Boolean(refs.stageVisible.current && refs.sessionId.current),
        hasLiveGame: (): boolean => Boolean(
            refs.sessionId.current
            && refs.liveGameSessionId.current === refs.sessionId.current
            && refs.liveGame.current,
        ),
        isPlaythroughRunning: (): boolean => Boolean(
            refs.gameEntered.current
            && refs.sessionId.current
            && refs.liveGameSessionId.current === refs.sessionId.current
            && refs.liveGame.current,
        ),
    };
}
