/**
 * Whether a page is drawn over the game stage, for the Game UI drawn inside it.
 *
 * The slot surfaces are created once per engine session and rendered by the engine's own Player, so
 * a value handed to them at creation would be the one the session started with. A context reaches
 * them wherever the Player puts them, and re-renders them when the answer changes.
 *
 * `false` by default, which is the answer for every host that draws no pages over its stage - the
 * story editor's preview among them.
 *
 * Comments in English per project convention.
 */

import { createContext, useContext } from "react";

/** See `isStageCoveredByPage` for what "covered" means, and `isStageSlotConcealedByPage` for what it does. */
export const StageCoveredByPageContext = createContext(false);

export function useStageCoveredByPage(): boolean {
    return useContext(StageCoveredByPageContext);
}
