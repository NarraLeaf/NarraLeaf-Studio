/**
 * Where the engine is in the author's story, as opposed to where it is in its own action tree.
 *
 * The compiler stamps a static id on the actions it builds for a row (see `recordStatement`), and
 * that stamp is the only link an engine action has back to a line somebody wrote. It does not reach
 * everything: a row expands into a chain, and the engine fills that chain with machinery of its own
 * - `scene:preSuspend`, `scene:init`, `displayable:init`, a transition - which no compiler ever
 * touched. Those actions get the engine's positional fallback id (`a-0`, `a-1`, ...) and appear in
 * no binding table.
 *
 * Which matters because the machinery is exactly what throws. A returnable jump naming a scene that
 * is already on the call stack fails in `scene:preSuspend`, and asking only "what is the id of the
 * action running right now" answers `a-8`, answers nothing, and reports the failure as having no
 * place in the story at all - for the one failure the panel most needed to place.
 *
 * The action that ran immediately before it is the `control:do` the compiler stamped with the jump
 * row's own id. So the last row the play head could name IS the row the author wrote, and holding on
 * to it turns "somewhere" into "line 12 of Corridor". That is not a guess dressed as a fact:
 * `playHead` attribution is defined as the row playback WAS on (see `GameAppIssueOrigin`), which is
 * precisely what this returns.
 *
 * The alternative - stamping every nested action too - is not available. Saves serialise action ids
 * and restore by looking them up (`LiveGame` builds its map from `action.getId()`), and the engine's
 * fallback ids are positional, so naming the nested actions renumbers every action after them and
 * points every save ever written at the wrong one.
 *
 * Engine- and React-free so the resolution can be driven with real compiled bindings in a test.
 */

/** One row-to-action link, as the story compiler records it. */
export type PlayHeadActionBinding = {
    /** The id the compiler stamped on the action, and the id the engine will report for it. */
    staticId: string;
    /** The Studio row the compiler built it from. */
    blockId: string;
};

export type PlayHead = {
    /** Follow the engine's current-action stream. Null is "nothing is running". */
    observe(actionId: string | null): void;
    /** The engine's own id for the action running now - raw, unresolved, and possibly unnamed. */
    actionId(): string | null;
    /**
     * The row to attribute to: the one the play head is standing on, or the last one it could name.
     * Undefined only when the run has not reached an authored row at all, which is the honest answer
     * for a boot failure and is what makes such a report `session` rather than a row.
     */
    blockId(): string | undefined;
    /**
     * The rows this run has named, oldest first, ending with {@link blockId}.
     *
     * Kept because a hot reload has to answer "the nearest surviving row before the one you were on"
     * against a document that no longer contains that row - so there is nothing in the new document
     * to walk backwards from, and what the run actually played is the only record of what came
     * before. Bounded (see {@link PLAY_HEAD_TRAIL_LIMIT}); consecutive repeats of one row - a line
     * re-entered by a loop, or an action chain the compiler stamped more than once - collapse, so
     * the bound holds a real span of story rather than one row a thousand times.
     */
    trail(): readonly string[];
    /**
     * Put a run's history back after the environment under it was replaced.
     *
     * A hot reload mounts a new session, which resets this one along with everything else the old
     * environment owned - but the PLAYER did not restart, and the reload puts them back where they
     * were. Without the history they came with, the first edit after a reload has nothing earlier to
     * fall back to and sends them to the top of the scene.
     */
    seedTrail(rows: readonly string[]): void;
    /** Forget the run. Called wherever a session is torn down or replaced. */
    reset(): void;
};

/**
 * How many played rows are remembered.
 *
 * The only reader wants the nearest surviving one, so what matters is that the window covers the
 * rows an author could plausibly delete in one edit - a scene's worth, not a playthrough's. The
 * entries are ids, so a few hundred of them cost nothing worth measuring.
 */
export const PLAY_HEAD_TRAIL_LIMIT = 256;

/**
 * Track the play head against a binding table read at call time.
 *
 * The table is read through a callback rather than captured because a hot reload recompiles the
 * story and mints a new one; a play head holding the previous compile's table would resolve every
 * id against rows that no longer exist.
 */
export function createPlayHead(readBindings: () => readonly PlayHeadActionBinding[]): PlayHead {
    let currentActionId: string | null = null;
    let lastNamedBlockId: string | undefined;
    let trail: string[] = [];

    const named = (actionId: string | null): string | undefined => {
        if (!actionId) {
            return undefined;
        }
        return readBindings().find(binding => binding.staticId === actionId)?.blockId;
    };

    return {
        observe(actionId) {
            currentActionId = actionId;
            const blockId = named(actionId);
            // Only ever moved forward onto a row that resolved. An engine-internal action leaves it
            // where it was, which is the whole point.
            if (blockId) {
                lastNamedBlockId = blockId;
                if (trail[trail.length - 1] !== blockId) {
                    trail.push(blockId);
                    if (trail.length > PLAY_HEAD_TRAIL_LIMIT) {
                        trail = trail.slice(trail.length - PLAY_HEAD_TRAIL_LIMIT);
                    }
                }
            }
        },
        actionId: () => currentActionId,
        blockId: () => named(currentActionId) ?? lastNamedBlockId,
        trail: () => trail,
        seedTrail(rows) {
            trail = rows.slice(Math.max(0, rows.length - PLAY_HEAD_TRAIL_LIMIT));
        },
        reset() {
            currentActionId = null;
            lastNamedBlockId = undefined;
            trail = [];
        },
    };
}
