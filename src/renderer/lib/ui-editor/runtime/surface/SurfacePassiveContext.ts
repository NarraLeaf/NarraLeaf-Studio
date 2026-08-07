import { createContext, useContext } from "react";

/**
 * Marks a surface as display-only: nothing inside it takes pointer events.
 *
 * `pointer-events: none` on an ancestor does not survive a descendant setting it back to `auto`, and
 * every non-root widget wrapper sets it to `auto` — so a slot whose shell is click-through is still
 * fully blocking as soon as it holds one full-size container. That is not hypothetical: the
 * notification slot's toast list is a 440x400 box pinned to the top right of the stage, and with no
 * notifications on screen at all it swallowed every click in that corner, which reads to a player as
 * "the dialogue sometimes doesn't advance".
 *
 * A context rather than a prop because the wrappers are rendered by a deeply recursive tree walker
 * threaded with positional arguments; this reaches the one place that decides `pointerEvents`
 * without touching that signature.
 */
export const SurfacePassiveContext = createContext(false);

export function useSurfacePassive(): boolean {
    return useContext(SurfacePassiveContext);
}
