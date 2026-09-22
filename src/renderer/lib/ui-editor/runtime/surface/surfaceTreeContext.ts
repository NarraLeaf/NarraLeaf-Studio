import { createContext, useContext } from "react";

/**
 * Whether the tree a widget is drawn in takes pointer and keyboard input right now.
 *
 * Two separate answers, because they open at different moments: a page's keys open when it is
 * revealed, its pointer only once it is also present and not playing out (see `AppSurfaceLayer`).
 */
export type SurfaceTreeInteractivity = {
    interactive: boolean;
    keyboardInteractive: boolean;
};

/** Where a surface's widgets hear that the surface itself entered or is leaving; see `BlueprintWidgetInitLifecycle`. */
export type SurfaceLifecycleSignals = {
    beforeSurfaceExit: number;
    afterSurfaceEnter: number;
};

const FULLY_INTERACTIVE: SurfaceTreeInteractivity = Object.freeze({ interactive: true, keyboardInteractive: true });

/**
 * The two inputs of an element tree that change for the whole tree at once, and are read by only a
 * few things in it.
 *
 * # Why these are contexts and not arguments of the walk
 *
 * A page becomes interactive when its enter animation reveals it, and hears `afterSurfaceEnter` when
 * that animation ends - each a single change of one value for every element on the page. Handed down
 * the tree walk, each one was an input every element's drawing depended on, so each rebuilt the whole
 * page: every wrapper, every widget renderer, every chrome, every motion node. Measured on a shipped
 * build, a switch to a 287-element page spent about 3,500 of its component renders on these two
 * moments alone.
 *
 * What actually reads them is small: the element wrapper (whether it listens for pointer and keys),
 * a frame (whether the page it draws may), and the widget init lifecycle (the signals). Read from a
 * context, a change re-renders those and nothing else, and the tree's remembered nodes stay valid.
 *
 * Provided at the root of each tree (`SurfaceElementTree`), above the memo boundary, so a change
 * never walks the tree. A tree nested in a frame provides its own.
 */
export const SurfaceTreeInteractivityContext = createContext<SurfaceTreeInteractivity>(FULLY_INTERACTIVE);

export const SurfaceTreeLifecycleSignalsContext = createContext<SurfaceLifecycleSignals | undefined>(undefined);

export function useSurfaceTreeInteractivity(): SurfaceTreeInteractivity {
    return useContext(SurfaceTreeInteractivityContext);
}

export function useSurfaceTreeLifecycleSignals(): SurfaceLifecycleSignals | undefined {
    return useContext(SurfaceTreeLifecycleSignalsContext);
}
