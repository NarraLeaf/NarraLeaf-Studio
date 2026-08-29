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
    /** Forget the run. Called wherever a session is torn down or replaced. */
    reset(): void;
};

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
            }
        },
        actionId: () => currentActionId,
        blockId: () => named(currentActionId) ?? lastNamedBlockId,
        reset() {
            currentActionId = null;
            lastNamedBlockId = undefined;
        },
    };
}
