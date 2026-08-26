import { createContext, useContext } from "react";

/**
 * Something drawn on an outline row that this module knows nothing about.
 *
 * **A seam, and the reason it is one is the runtime bundle.** The layer outline is part of
 * `lib/ui-editor`, which the game runtime compiles; a live session is Studio's and must never reach
 * that far. So the outline declares a place where a badge can go and the workspace supplies what
 * goes in it - today the mark saying who else in a room has an element open.
 *
 * A component rather than a node, because what it draws depends on state the outline cannot see: the
 * supplier reads the room's claim set through its own context, and rendering it here is what puts it
 * inside that context.
 *
 * Nothing by default, which is what the runtime and every non-session workspace get.
 */
export type OutlineElementBadge = (props: { elementId: string }) => React.ReactNode;

const OutlineElementBadgeContext = createContext<OutlineElementBadge | null>(null);

export const OutlineElementBadgeProvider = OutlineElementBadgeContext.Provider;

/** What to draw beside one row's name, or null when nothing has been supplied. */
export function useOutlineElementBadge(): OutlineElementBadge | null {
    return useContext(OutlineElementBadgeContext);
}
