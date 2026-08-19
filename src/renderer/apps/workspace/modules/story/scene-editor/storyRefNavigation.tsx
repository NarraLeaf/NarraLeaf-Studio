import { createContext, useContext, type ReactNode } from "react";
import type { StoryCommandLineRef } from "./storyCommandLine";
import { useJumpModifierHeld } from "./useJumpModifier";

/**
 * What a row can do with a word that points at something: ask whether it leads anywhere, and go.
 *
 * Deliberately two questions rather than one `open` that quietly does nothing. The affordance is the
 * only thing telling the author a word is a way through — a word that lights up under the modifier
 * and then goes nowhere is worse than a word that never lit up, because the second one costs a look
 * and the first one costs a click plus the suspicion that the editor is broken.
 *
 * Held as a context rather than threaded through the row tree for the reason
 * {@link StoryCommandLineContextValue} gives: a scene is hundreds of rows, and this is resolved once
 * per editor tab. The value must therefore keep a STABLE identity across document edits — see the
 * provider, which latches the document in a ref for exactly that.
 *
 * The implementation lives in `StoryRefNavigationProvider`, in its own module, so that nothing on the
 * consuming side pulls the whole navigation graph in behind it: `jumpToSearchTarget` reaches the
 * scene editor tab, and a token that imported it would drag the editor into every test that renders
 * one word.
 */
export type StoryRefNavigation = {
    /** Whether this reference has somewhere to go in this project, right now. */
    canOpen: (ref: StoryCommandLineRef) => boolean;
    /** Go there. Safe to call only when {@link canOpen} said yes. */
    open: (ref: StoryCommandLineRef) => void;
};

export const StoryRefNavigationContext = createContext<StoryRefNavigation | null>(null);

/** Publishes one destination resolver to every row below. */
export function StoryRefNavigationScope(props: { value: StoryRefNavigation | null; children: ReactNode }) {
    return <StoryRefNavigationContext.Provider value={props.value}>{props.children}</StoryRefNavigationContext.Provider>;
}

/** A word's link, as the token that draws it needs it. `armed` is the modifier, held right now. */
export type StoryRefLink = {
    /** The modifier is down: draw the word as a link and take the click. */
    armed: boolean;
    open: () => void;
};

/**
 * The link behind one word, or `null` when there is none to offer.
 *
 * `null` covers three cases the caller must not tell apart: the word points at nothing (no `ref`),
 * the surface has no navigation (the Dev Mode timeline, a clipboard preview, a test), and the
 * reference no longer resolves (a declaration row deleted since the line was written). All three mean
 * the same thing to the token — draw the word, offer nothing.
 */
export function useStoryRefLink(ref: StoryCommandLineRef | undefined): StoryRefLink | null {
    const navigation = useContext(StoryRefNavigationContext);
    // Subscribed unconditionally, above every early return: hooks cannot be skipped, and a token that
    // is an edit today and a link tomorrow must not change how many it calls.
    const held = useJumpModifierHeld();
    if (!ref || !navigation || !navigation.canOpen(ref)) {
        return null;
    }
    return { armed: held, open: () => navigation.open(ref) };
}
