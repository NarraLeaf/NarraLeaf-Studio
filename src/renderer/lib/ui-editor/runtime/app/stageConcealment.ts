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

/**
 * Whether anything is drawn over the stage that takes the keyboard from it: a page, or a modal
 * layer (see `isStageCovered`).
 *
 * The other half of the rule `keyboardOwner` applies to a key's surface heads and actions: the stage
 * hears the keys only while the story is what the player is looking at. The widgets on the stage hear
 * keys through heads of their own - `On Key Down` on a button in the quick menu - which listen on the
 * window rather than going through that dispatch, so they are told here. Without it a page opened
 * over the game took Space and Escape for itself while every key head on the stage underneath went on
 * answering the same press.
 *
 * `false` by default, for the same reason as the page answer above.
 */
export const StageCoveredContext = createContext(false);

export function useStageCovered(): boolean {
    return useContext(StageCoveredContext);
}
