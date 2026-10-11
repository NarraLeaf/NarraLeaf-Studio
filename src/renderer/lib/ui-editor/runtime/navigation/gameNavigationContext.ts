/**
 * Whether the running game has keyboard and pad navigation: whether any of the project's intents
 * fills a navigation slot (`hasUINavigationSlots`).
 *
 * A project that fills none plays as it did before navigation existed - no box a click answers turns
 * into a Tab stop, no slider into one, a list keeps its own arrow keys - so everything that would
 * only be there for navigation asks this first. False outside a running game: the editor canvas has
 * no focus to move.
 *
 * Comments in English per project convention.
 */

import { createContext, useContext } from "react";

export const GameNavigationContext = createContext(false);

export function useGameNavigationEnabled(): boolean {
    return useContext(GameNavigationContext);
}
